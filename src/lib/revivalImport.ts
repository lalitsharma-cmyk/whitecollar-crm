// ── Revival Import (DRY core for BOTH intake routes) ─────────────────────────
// The Revival Engine import re-engages leads that ALREADY exist. Where a normal
// Leads import would SKIP a duplicate, a `dupMode="revival"` import PROCESSES the
// existing lead — strictly NON-DESTRUCTIVELY — so it re-enters the Revival bucket
// with its history intact and any genuinely-empty fields enriched.
//
// Called from src/app/api/intake/csv/route.ts and
// src/app/api/intake/google-sheet/route.ts (the SAME function in both, per the
// lib-query parity rule) when the dup branch finds an existing active lead under
// revival mode.
//
// THE 8 BEHAVIORS (owner-approved spec — every one is additive / reversible):
//   1. Merge existing data — FILL-IF-EMPTY ONLY. A non-blank existing field is
//      NEVER overwritten (`existing.field ?? incoming` semantics).
//   2. Append imported remarks — via mergeRawRemark (append-only; never truncates
//      or overwrites). Appended text parses into the Smart Timeline on render.
//   3. Smart Timeline entry — ONE Activity row, type NOTE (existing enum, NO
//      migration), status DONE, dated now.
//   4. Revival fields — leadOrigin="REVIVAL" + isColdCall=true → lead shows in the
//      Revival Engine (same as the master-data move_to_revival action).
//   5. Revival source — stamped onto coldCallReason (existing column) AND
//      customFields["Revival Source"] = the import file/source. No migration.
//   6. Project if empty — fill sourceDetail only when blank.
//   7. Tags — UNION (append new tags to the existing CSV; never replace).
//   8. Import audit — one LeadFieldHistory row per ACTUALLY-changed field (via the
//      shared recordFieldChanges helper, source="revival-import"), so the
//      enrichment is fully traceable + reversible by hand even though it is NOT
//      stamped with importBatchId (the lead pre-existed; a batch rollback must not
//      delete it).
//
// PRODUCTION-SAFETY GUARANTEES:
//   • Structured fields: fill-if-empty only.
//   • Remarks/history: append-only (mergeRawRemark).
//   • deletedAt-aware: the CALLER looks up `{ fingerprint, deletedAt: null }`, so a
//     soft-deleted match never reaches here — it CREATES a fresh lead instead.
//   • No schema migration (reuses leadOrigin/isColdCall/coldCallReason/customFields
//     /tags/sourceDetail + the NOTE ActivityType + LeadFieldHistory).

import { ActivityType, ActivityStatus, type Prisma } from "@prisma/client";
import { mergeRawRemark } from "@/lib/rawRemarks";
import { recordFieldChanges } from "@/lib/fieldHistory";

// Minimal DB shape satisfied by BOTH `prisma` and an interactive-transaction `tx`
// — so the routes pass `prisma` and the rolled-back test harness passes `tx`.
export type RevivalDB = {
  lead: {
    findUnique: (args: {
      where: { id: string };
      select?: Prisma.LeadSelect;
    }) => Promise<Record<string, unknown> | null>;
    update: (args: {
      where: { id: string };
      data: Prisma.LeadUpdateInput;
    }) => Promise<unknown>;
  };
  activity: {
    create: (args: { data: Prisma.ActivityCreateInput }) => Promise<unknown>;
  };
  leadFieldHistory: {
    createMany: (args: {
      data: Prisma.LeadFieldHistoryCreateManyInput[];
    }) => Promise<unknown>;
  };
};

// Structured fields the importer may carry that we FILL-IF-EMPTY on the existing
// lead. Each is written only when the existing value is blank AND the incoming
// value is present. Order is irrelevant; this is the single source of truth for
// "which mapped columns can revival enrich". `sourceDetail` is handled separately
// (project-if-empty) so it is NOT listed here. Remarks/tags/leadOrigin/isColdCall
// /revival-source are also handled with their own dedicated logic below.
const FILL_IF_EMPTY_FIELDS = [
  // identity / contact
  "altName", "altPhone", "altEmail", "company", "address", "profession", "linkedInUrl",
  // requirement
  "configuration", "propertyType", "city", "state", "country",
  // budget (only when the existing budget is unset — a blank never wipes)
  "budgetMin", "budgetMax", "budgetRaw", "budgetCurrency",
  // BANT depth + signals
  "potential", "fundReadiness", "moodStatus", "whenCanInvest",
  "authorityLevel", "authorityPerson", "needSummary",
  // pipeline / provenance (NEVER overwrite a worked status)
  "currentStatus", "categorization", "sourceRaw",
  "whoIsClient", "clientType",
  // cold-data extras
  "alreadyBought", "alreadyBoughtBy", "detailShared", "todoNext",
  // scheduling (fill only when the slot is empty)
  "followupDate", "meetingDate", "siteVisitDate",
  // team / routing — fill only when unclassified
  "forwardedTeam", "routingMethod", "routingSource", "routingReason",
] as const;

// `select` for the existing-lead snapshot — every field we read for fill-if-empty
// decisions, plus the audit/append sources (rawRemarks, remarks, tags,
// sourceDetail, leadOrigin, isColdCall, coldCallReason, customFields, ownerId).
const SNAPSHOT_SELECT: Prisma.LeadSelect = {
  id: true, ownerId: true,
  rawRemarks: true, remarks: true, tags: true, sourceDetail: true,
  leadOrigin: true, isColdCall: true, coldCallReason: true, customFields: true,
  ...Object.fromEntries(FILL_IF_EMPTY_FIELDS.map((f) => [f, true])),
};

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

// Union two comma-separated tag CSVs without dropping or duplicating (case-insensitive
// de-dupe; preserves the existing order, then appends genuinely-new tags).
function unionTags(existing: string | null | undefined, incoming: string | null | undefined): string | null {
  const ex = (existing ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const inc = (incoming ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (inc.length === 0) return existing && existing.trim() ? existing : (ex.length ? ex.join(",") : null);
  const seen = new Set(ex.map((t) => t.toLowerCase()));
  const merged = [...ex];
  for (const t of inc) {
    if (!seen.has(t.toLowerCase())) { merged.push(t); seen.add(t.toLowerCase()); }
  }
  return merged.length ? merged.join(",") : null;
}

export interface RevivalMergeArgs {
  /** Transaction-or-prisma handle. */
  db: RevivalDB;
  /** The existing ACTIVE lead matched by fingerprint (deletedAt:null). */
  existingId: string;
  /** Structured candidate values the route extracted from the row (the route's
   *  `update`-style object). Only keys in FILL_IF_EMPTY_FIELDS are considered for
   *  enrichment; everything else here is ignored (revival never overwrites). */
  incoming: Record<string, unknown>;
  /** The row's verbatim remark text (appended via mergeRawRemark). */
  remark?: string | null;
  /** Project / Property-Enquired value — fills sourceDetail only when empty. */
  project?: string | null;
  /** Comma-separated tags from the row — UNION'd onto the existing tags. */
  tags?: string | null;
  /** Revival source label (the import file/source) — stamped onto coldCallReason
   *  (if empty) AND customFields["Revival Source"]. */
  revivalSource: string;
  /** Import file name — used in the remark separator + the NOTE Activity title. */
  fileName: string;
  /** Who ran the import (for the LeadFieldHistory audit). */
  changedById: string | null;
}

export interface RevivalMergeResult {
  /** Lead id (echoed for convenience). */
  leadId: string;
  /** Count of LeadFieldHistory rows written (== number of fields that changed). */
  fieldChanges: number;
  /** True if the remark log grew. */
  remarkAppended: boolean;
}

/**
 * Re-engage an existing lead from a Revival import. Strictly non-destructive — see
 * the file header for the full contract. Writes the Lead update, a NOTE Smart-
 * Timeline entry, and a per-field LeadFieldHistory audit. Returns what changed.
 *
 * Intentionally does NOT stamp importBatchId — the lead pre-existed, so a batch
 * rollback must not soft-delete it. The LeadFieldHistory rows are the per-field
 * undo trail instead.
 */
export async function applyRevivalMerge(args: RevivalMergeArgs): Promise<RevivalMergeResult> {
  const { db, existingId, incoming, remark, project, tags, revivalSource, fileName, changedById } = args;

  const existing = (await db.lead.findUnique({
    where: { id: existingId },
    select: SNAPSHOT_SELECT,
  })) as Record<string, unknown> | null;
  if (!existing) {
    // Defensive: caller already found it, but guard against a race.
    return { leadId: existingId, fieldChanges: 0, remarkAppended: false };
  }

  const data: Prisma.LeadUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  // (1) FILL-IF-EMPTY structured fields — never overwrite a non-blank existing value.
  for (const f of FILL_IF_EMPTY_FIELDS) {
    const incVal = incoming[f];
    if (incVal === undefined || incVal === null) continue;        // nothing to add
    if (typeof incVal === "string" && incVal.trim() === "") continue;
    if (!isBlank(existing[f])) continue;                          // already set → keep
    (data as Record<string, unknown>)[f] = incVal;
    before[f] = existing[f] ?? null;
    after[f] = incVal;
  }

  // (6) Project → sourceDetail, ONLY when the existing sourceDetail is empty.
  if (project && project.trim() && isBlank(existing.sourceDetail)) {
    data.sourceDetail = project.trim();
    before.sourceDetail = existing.sourceDetail ?? null;
    after.sourceDetail = project.trim();
  }

  // (2) Append the imported remark — append-only, never truncates/overwrites.
  let remarkAppended = false;
  if (remark && remark.trim()) {
    const merged = mergeRawRemark(existing.rawRemarks as string | null, remark, fileName);
    // mergeRawRemark returns the existing bytes unchanged when the incoming is a
    // subset/identical — only record a change when the log actually grew.
    if (merged !== (existing.rawRemarks ?? null) && merged !== existing.rawRemarks) {
      data.rawRemarks = merged;
      data.remarks = merged;
      before.remarks = (existing.remarks ?? existing.rawRemarks ?? null);
      after.remarks = merged;
      remarkAppended = true;
    }
  }

  // (7) Tags — UNION (append-only).
  const tagsMerged = unionTags(existing.tags as string | null, tags ?? null);
  if (tagsMerged !== (existing.tags ?? null) && tagsMerged !== existing.tags) {
    data.tags = tagsMerged;
    // tags is not in TRACKED_FIELDS, so add a dedicated history row below.
  }

  // (4) Revival fields — move the lead into the Revival Engine. ALWAYS applied
  //     (that's the whole point of a revival import), recorded when it changes.
  if (existing.leadOrigin !== "REVIVAL") {
    data.leadOrigin = "REVIVAL";
    before.leadOrigin = existing.leadOrigin ?? null;
    after.leadOrigin = "REVIVAL";
  }
  if (existing.isColdCall !== true) {
    data.isColdCall = true;
    // isColdCall is not a TRACKED_FIELD; dedicated history row below.
  }

  // (5) Revival source — coldCallReason (fill-if-empty) + customFields marker.
  if (isBlank(existing.coldCallReason)) {
    data.coldCallReason = `Revival import — ${revivalSource}`;
    before.coldCallReason = existing.coldCallReason ?? null;
    after.coldCallReason = `Revival import — ${revivalSource}`;
  }
  const prevCustom = (existing.customFields as Record<string, unknown> | null) ?? null;
  const nextCustom = { ...(prevCustom ?? {}), "Revival Source": revivalSource };
  data.customFields = nextCustom as Prisma.InputJsonValue;

  // lastTouchedAt — reflect the re-engagement (sorts the lead up in Revival).
  data.lastTouchedAt = new Date();

  // ── Persist the Lead enrichment ──
  await db.lead.update({ where: { id: existingId }, data });

  // (3) Smart Timeline entry — one NOTE row, dated now, status DONE.
  const now = new Date();
  await db.activity.create({
    data: {
      lead: { connect: { id: existingId } },
      // Actor = the user who RAN the import (changedById), never the lead owner.
      // A revival import is a human-initiated action owned by the importer
      // (Lalit, 2026-07-01). Null only if somehow run without a user → "System".
      ...(changedById ? { user: { connect: { id: changedById } } } : {}),
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: `Revival import — re-engaged from ${fileName}`,
      description: remark?.trim() ? remark.trim().slice(0, 1000) : `Re-engaged via revival import (source: ${revivalSource}).`,
      completedAt: now,
    },
  });

  // (8) Per-field audit. recordFieldChanges covers every TRACKED_FIELD present in
  //     `after`; tags + isColdCall are not tracked there, so append them manually.
  let fieldChanges = await recordFieldChanges(
    db,
    existingId,
    changedById,
    before,
    after,
    "revival-import",
  );
  const extraRows: Prisma.LeadFieldHistoryCreateManyInput[] = [];
  if (data.tags !== undefined && tagsMerged !== (existing.tags ?? null)) {
    extraRows.push({
      leadId: existingId, field: "tags",
      oldValue: (existing.tags as string | null) ?? null, newValue: tagsMerged,
      changedById, source: "revival-import",
    });
  }
  if (data.isColdCall === true && existing.isColdCall !== true) {
    extraRows.push({
      leadId: existingId, field: "isColdCall",
      oldValue: String(existing.isColdCall ?? false), newValue: "true",
      changedById, source: "revival-import",
    });
  }
  if (extraRows.length) {
    await db.leadFieldHistory.createMany({ data: extraRows });
    fieldChanges += extraRows.length;
  }

  return { leadId: existingId, fieldChanges, remarkAppended };
}

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseImportDate } from "@/lib/parseImportDate";
import { normalizeBuyerKey, toJsonArray, primaryPhone, parseJsonArray } from "@/lib/buyerIntelligence";
import { buildBuyerTimelinePlan, composeRemarkFromFields, isImportedActivityDescription } from "@/lib/buyerRemarkTimeline";
import { normalizeName, normalizeNameList } from "@/lib/nameFormat";
import { audit, reqMeta } from "@/lib/audit";

// ── Buyer import — ADMIN ONLY (passport + financial data) ────────────────────
// Two actions on this one endpoint:
//   POST {init:true, source, sourceRef, total}  → create a BuyerImportBatch, return its id.
//   POST {batchId, rows:[...], dupMode}          → create/update BuyerRecords for a chunk,
//                                                  log failures to BuyerImportLog,
//                                                  bump the batch counters.
//
// PARITY WITH LEAD IMPORTS (src/app/api/intake/csv/route.ts):
//   • Remarks: a mapped Remarks/Notes column — OR, when absent, short status-like
//     columns (Status / Follow-Up / etc.) composed into one line — is stored
//     VERBATIM on BuyerRecord.remarks (= the Raw History source). Never reformatted.
//   • Smart Timeline: BuyerActivity rows are derived from that remark using the SAME
//     parser the Lead view uses (historical dates honored; else the import date).
//   • rawImport: the ENTIRE original row is stored verbatim (immutable audit), like
//     Lead.rawImport — surfaced in the buyer detail "Imported Fields → Original Row".
//   • Dedup: re-import no longer silently creates duplicate rows. We match an
//     existing LIVE buyer by buyerKey / phone-tail / email and apply the admin's
//     chosen dupMode (skip | update | create | history). Default = skip (safe).
//
// Each row carries the MAPPED buyer fields, an `_extra` object of every unmapped
// column (→ extraFields verbatim), and `_raw` = the COMPLETE original row (→ rawImport).

type ImportRow = {
  clientName?: string;
  coBuyerNames?: string;     // delimited or single
  phones?: string;
  emails?: string;
  passport?: string;
  passportExpiry?: string;
  nationality?: string;
  ownerName?: string;
  country?: string;
  projectName?: string;
  tower?: string;
  unitNumber?: string;
  propertyType?: string;
  configuration?: string;
  size?: string;
  actualSize?: string;
  area?: string;
  transactionValue?: string;
  pricePerSqFt?: string;
  transactionDate?: string;
  transactionId?: string;
  transactionType?: string;
  role?: string;
  agentName?: string;
  remarks?: string;          // mapped free-text remarks / notes / activity history
  _extra?: Record<string, string>;   // unmapped columns, verbatim → extraFields
  _raw?: Record<string, string>;     // the COMPLETE original row, verbatim → rawImport
};

// Dedup behaviour for a row that matches an existing LIVE buyer.
//   skip    — do nothing (default; never creates a duplicate)
//   update  — fill the existing buyer's blank fields + grow remarks/activity
//   create  — import as a brand-new buyer anyway (explicit admin choice)
//   history — append the imported remark as conversation history on the existing
//             buyer (grow remarks + add BuyerActivity), without touching its fields
type DupMode = "skip" | "update" | "create" | "history";
const DUP_MODES = new Set<DupMode>(["skip", "update", "create", "history"]);

function num(v?: string): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? null : n;
}
const str = (v?: string): string | null => {
  const t = String(v ?? "").trim();
  return t || null;
};

// Last-8 digit phone tail (matches normalizeBuyerKey's tail) for dedup matching.
const tail8 = (p?: string | null): string => String(p ?? "").replace(/\D/g, "").slice(-8);

// Status-like extra columns that, when no free-text remarks column is mapped, are
// composed into the remark (so this history-bearing data gets a Raw History +
// Smart Timeline instead of sitting inert in extraFields). Order = display order.
const STATUS_LIKE_KEYS = ["status", "status 2", "status2", "follow-up", "followup", "follow up", "remark", "remarks", "notes", "note", "comment", "comments", "activity", "activity history"];
function composeFromExtra(extra: Record<string, string>): string {
  const picked: Record<string, string> = {};
  for (const k of Object.keys(extra)) {
    if (STATUS_LIKE_KEYS.includes(k.trim().toLowerCase()) && String(extra[k] ?? "").trim()) {
      picked[k] = extra[k];
      // Composed into the remark (→ Raw + Smart) — REMOVE from extra so the same
      // status text isn't ALSO shown verbatim in the Imported Fields card (the
      // duplication pickConversation already avoids). rawImport keeps the original.
      delete extra[k];
    }
  }
  return composeRemarkFromFields(picked);
}

// Free-text conversation / interaction-history columns. The Dubai buyer sheets
// carry a "Conversation History" column = the REAL dated conversation ("On 5 June
// 2026 (4:31PM) he called back…"). When the admin maps a short Status column to
// Remarks and leaves this one unmapped, it lands in extraFields → the Imported
// Fields card instead of the Conversation timeline (Lalit P0, 2026-06-27). It is
// recognised here as the PRIMARY remarks / Smart-Timeline source. pickConversation
// REMOVES the chosen key from `extra` so the conversation lives in the timeline,
// never duplicated in Imported Fields (rawImport keeps the verbatim original row).
const CONVERSATION_KEYS = [
  "conversation history", "conversation", "call history", "remark history",
  "interaction history", "communication history", "discussion", "chat history",
];
function pickConversation(extra: Record<string, string>): string | null {
  for (const k of Object.keys(extra)) {
    if (CONVERSATION_KEYS.includes(k.trim().toLowerCase()) && String(extra[k] ?? "").trim()) {
      const v = String(extra[k]).trim();
      delete extra[k]; // move into remarks; rawImport retains the verbatim audit
      return v;
    }
  }
  return null;
}

/** Find a LIVE (non-deleted) existing buyer matching this row by buyerKey first,
 *  then by phone-tail, then by email. Returns the match or null. */
async function findExistingBuyer(
  buyerKey: string | null,
  phonesJson: string | null,
  emailsJson: string | null,
): Promise<{ id: string; remarks: string | null; extraFields: unknown; rawImport: unknown } | null> {
  const select = { id: true, remarks: true, extraFields: true, rawImport: true } as const;
  // 1) buyerKey (name+phone-tail hash) — the strongest signal, already computed.
  if (buyerKey) {
    const byKey = await prisma.buyerRecord.findFirst({ where: { buyerKey, deletedAt: null, market: "Dubai" }, select });
    if (byKey) return byKey;
  }
  // 2) phone tail — any stored buyer whose primary phone shares the last-8 digits.
  const phone = primaryPhone(phonesJson, null);
  const t = tail8(phone);
  if (t.length >= 7) {
    // phones is a JSON string column; contains() on the tail is a safe pre-filter,
    // then we confirm the tail in app code (avoids a false hit on a substring).
    const candidates = await prisma.buyerRecord.findMany({
      where: { deletedAt: null, market: "Dubai", phones: { contains: t } },
      select: { ...select, phones: true },
      take: 25,
    });
    for (const c of candidates) {
      if (parseJsonArray(c.phones).some((p) => tail8(p) === t)) {
        return { id: c.id, remarks: c.remarks, extraFields: c.extraFields, rawImport: c.rawImport };
      }
    }
  }
  // 3) email — exact (case-insensitive) match on any stored email.
  const emails = parseJsonArray(emailsJson);
  for (const e of emails) {
    const lc = e.toLowerCase();
    const candidates = await prisma.buyerRecord.findMany({
      where: { deletedAt: null, market: "Dubai", emails: { contains: lc } },
      select: { ...select, emails: true },
      take: 25,
    });
    for (const c of candidates) {
      if (parseJsonArray(c.emails).some((x) => x.toLowerCase() === lc)) {
        return { id: c.id, remarks: c.remarks, extraFields: c.extraFields, rawImport: c.rawImport };
      }
    }
  }
  return null;
}

// Merge an imported remark into an existing buyer's remark blob WITHOUT losing
// history (append on a new line, skip if the exact text is already present).
// Mirrors the Lead importer's mergeRawRemark "grow, never overwrite" contract.
function mergeRemark(prev: string | null | undefined, incoming: string): string {
  const a = (prev ?? "").trim();
  const b = incoming.trim();
  if (!b) return a;
  if (!a) return b;
  if (a.includes(b)) return a; // already captured — no duplicate
  return `${a}\n${b}`;
}

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only — buyer data is restricted." }, { status: 403 });

  const body = await req.json().catch(() => ({}));

  // ── Action 1: initialise a batch ──────────────────────────────────────────
  if (body.init === true) {
    const batch = await prisma.buyerImportBatch.create({
      data: {
        source: String(body.source ?? "Excel file").slice(0, 120),
        sourceRef: body.sourceRef ? String(body.sourceRef).slice(0, 300) : null,
        recordCount: Number(body.total) || 0,
        importedById: me.id,
      },
    });
    await audit({ userId: me.id, action: "buyer.import.start", entity: "BuyerImportBatch", entityId: batch.id, meta: { source: batch.source, total: batch.recordCount }, request: reqMeta(req) });
    return NextResponse.json({ id: batch.id });
  }

  // ── Action 2: import a chunk of rows ──────────────────────────────────────
  const batchId: string | null = typeof body.batchId === "string" && body.batchId ? body.batchId : null;
  const rows: ImportRow[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ imported: 0, failed: 0, updated: 0, skipped: 0 });

  // Dedup behaviour for rows that match an existing live buyer (admin's choice).
  const dupMode: DupMode = DUP_MODES.has(body.dupMode) ? body.dupMode : "skip";

  // Resolve the batch's first-seen row offset so logged rowNum is global, not
  // per-chunk. The client passes rowOffset (rows already processed).
  const rowOffset: number = Number(body.rowOffset) || 0;
  const sourceFile: string | null = body.sourceFile ? String(body.sourceFile).slice(0, 200) : null;

  let imported = 0;   // brand-new BuyerRecords created
  let updated = 0;    // existing buyers updated (dupMode=update) or appended (history)
  let skipped = 0;    // duplicates skipped (dupMode=skip)
  let failed = 0;
  let activitiesCreated = 0;
  const errorLogs: { batchId: string; rowNum: number; error: string; rawRow: object }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = rowOffset + i + 1;
    // Proper-Case the client name at the source (name field only). normalizeName
    // preserves intentional mixed-case + skips non-name values; multi-name cells
    // normalize each part. buyerKey/dedup/create below all see the clean name.
    const clientName = normalizeNameList(str(r.clientName));
    if (!clientName) {
      failed++;
      if (batchId) errorLogs.push({ batchId, rowNum, error: "Missing required field: Client Name", rawRow: { ...r } });
      continue;
    }
    try {
      const phonesJson = toJsonArray((r.phones ?? "").split(/[,;|]/));
      const emailsJson = toJsonArray((r.emails ?? "").split(/[,;|]/).map((e) => e.toLowerCase()));
      // Co-buyer names are also names — Proper-Case each element of the array.
      const coBuyersJson = toJsonArray((r.coBuyerNames ?? "").split(/[,;|]/).map((n) => normalizeName(n)));
      const buyerKey = normalizeBuyerKey(clientName, primaryPhone(phonesJson, null));
      const extra = r._extra && typeof r._extra === "object"
        ? Object.fromEntries(Object.entries(r._extra).filter(([k, v]) => k.trim() && String(v ?? "").trim()))
        : {};
      // rawImport = the COMPLETE original row, verbatim (immutable audit). Falls back
      // to the mapped+extra view if the client didn't send _raw (older clients).
      const rawRow: Record<string, string> = {};
      const rawSource = r._raw && typeof r._raw === "object" ? r._raw : { ...extra };
      for (const [k, v] of Object.entries(rawSource)) {
        const s = String(v ?? "").trim();
        if (k.trim() && s) rawRow[k] = s;
      }

      // Remarks (verbatim) → Raw History + Smart Timeline. Priority (Lalit P0,
      // 2026-06-27): an explicit conversation-history column FIRST (the buyer
      // sheets' real dated conversation — pulled OUT of extra so it isn't stranded
      // in Imported Fields), THEN the mapped Remarks column + composed short
      // status/follow-up tokens, appended as trailing context.
      const conv = pickConversation(extra); // mutates extra (removes the conv key)
      const mappedRemark = str(r.remarks);
      const statusBits = composeFromExtra(extra) || null; // status tokens (post-removal)
      const tail = [mappedRemark, statusBits].filter(Boolean).join("\n") || null;
      const remark = conv ? (tail ? `${conv}\n${tail}` : conv) : tail;

      // Transaction date drives the timeline fallback (the day this record relates
      // to). When absent, fall back to "now" (the import moment) — parity with how
      // a lead's undated remark falls back to the lead's createdAt.
      const txnDate = parseImportDate(r.transactionDate) ?? null;
      const timelineFallback = txnDate ?? new Date();

      // ── Dedup: does a LIVE buyer already match this row? ────────────────────
      const existing = dupMode === "create" ? null : await findExistingBuyer(buyerKey, phonesJson, emailsJson);

      if (existing && dupMode === "skip") {
        skipped++;
        continue;
      }

      if (existing && (dupMode === "update" || dupMode === "history")) {
        // Append the imported remark (grow, never overwrite) + (re)derive the
        // imported Smart-Timeline rows for the appended text. In UPDATE mode also
        // fill blank structured fields. NEVER touch a live agent-logged activity.
        const update: Record<string, unknown> = {};
        if (remark) update.remarks = mergeRemark(existing.remarks, remark);
        // Grow the rawImport audit (merge columns; blanks never overwrite).
        if (Object.keys(rawRow).length) {
          update.rawImport = { ...((existing.rawImport as Record<string, unknown>) ?? {}), ...rawRow };
        }
        if (Object.keys(extra).length) {
          update.extraFields = { ...((existing.extraFields as Record<string, unknown>) ?? {}), ...extra };
        }
        if (dupMode === "update") {
          // Fill blanks only — additive, never clobber an existing value.
          const fill: Record<string, unknown> = {
            coBuyerNames: coBuyersJson, phones: phonesJson, emails: emailsJson,
            passport: str(r.passport), passportExpiry: str(r.passportExpiry), nationality: str(r.nationality),
            ownerName: normalizeName(str(r.ownerName)), country: str(r.country),
            projectName: str(r.projectName), tower: str(r.tower), unitNumber: str(r.unitNumber),
            propertyType: str(r.propertyType), configuration: str(r.configuration),
            size: str(r.size), actualSize: str(r.actualSize), area: str(r.area),
            transactionValue: num(r.transactionValue), pricePerSqFt: num(r.pricePerSqFt),
            transactionDate: txnDate, transactionId: str(r.transactionId),
            transactionType: str(r.transactionType), role: str(r.role), agentName: normalizeName(str(r.agentName)),
          };
          const current = await prisma.buyerRecord.findUnique({ where: { id: existing.id } });
          for (const [k, v] of Object.entries(fill)) {
            if (v == null) continue;
            const cur = (current as Record<string, unknown> | null)?.[k];
            if (cur == null || cur === "") update[k] = v;
          }
        }
        if (Object.keys(update).length) {
          await prisma.buyerRecord.update({ where: { id: existing.id }, data: update });
        }
        // Smart Timeline — regenerate the IMPORTED rows IDEMPOTENTLY: drop the prior
        // imported-tagged rows for this buyer, then rebuild from the FULL MERGED
        // remark (not just the incoming fragment). Without this, re-importing the
        // same sheet (the normal "top up" flow) re-inserted every historical row
        // again → the timeline showed each conversation 2×/3× (P0, audit 2026-06-27);
        // and building from the fragment alone mis-dated undated lines. Live
        // agent-logged rows (no IMPORTED_TAG) are never touched.
        if (remark) {
          const mergedRemark = (update.remarks as string | undefined) ?? existing.remarks ?? remark;
          const existingActs = await prisma.buyerActivity.findMany({ where: { buyerId: existing.id }, select: { id: true, description: true } });
          const importedIds = existingActs.filter((a) => isImportedActivityDescription(a.description)).map((a) => a.id);
          if (importedIds.length) await prisma.buyerActivity.deleteMany({ where: { id: { in: importedIds } } });
          const plan = buildBuyerTimelinePlan(mergedRemark, timelineFallback);
          if (plan.length) {
            await prisma.buyerActivity.createMany({
              data: plan.map((p) => ({ buyerId: existing.id, userId: null, type: p.type, description: p.description, createdAt: p.createdAt })),
            });
            activitiesCreated += plan.length;
          }
        }
        updated++;
        continue;
      }

      // ── Create a brand-new BuyerRecord ──────────────────────────────────────
      const created = await prisma.buyerRecord.create({
        data: {
          clientName,
          coBuyerNames: coBuyersJson,
          phones: phonesJson,
          emails: emailsJson,
          passport: str(r.passport),
          passportExpiry: str(r.passportExpiry),
          nationality: str(r.nationality),
          ownerName: normalizeName(str(r.ownerName)),
          country: str(r.country),
          projectName: str(r.projectName),
          tower: str(r.tower),
          unitNumber: str(r.unitNumber),
          propertyType: str(r.propertyType),
          configuration: str(r.configuration),
          size: str(r.size),
          actualSize: str(r.actualSize),
          area: str(r.area),
          transactionValue: num(r.transactionValue),
          pricePerSqFt: num(r.pricePerSqFt),
          // transactionDate ALWAYS from the sheet — never the import timestamp.
          transactionDate: txnDate,
          transactionId: str(r.transactionId),
          transactionType: str(r.transactionType),
          role: str(r.role),
          agentName: normalizeName(str(r.agentName)),
          // Remarks verbatim → Raw History (never reformatted).
          remarks: remark,
          // Dubai Buyer Data — every import into THIS module is a Dubai-market
          // buyer. A future Gurgaon module would stamp its own market value.
          market: "Dubai",
          source: "Excel import",
          sourceFile,
          extraFields: Object.keys(extra).length ? extra : undefined,
          rawImport: Object.keys(rawRow).length ? rawRow : undefined,
          buyerKey,
          importBatchId: batchId,
        },
        select: { id: true },
      });
      imported++;

      // Smart Timeline — derive BuyerActivity rows from the imported remark.
      if (remark) {
        const plan = buildBuyerTimelinePlan(remark, timelineFallback);
        if (plan.length) {
          await prisma.buyerActivity.createMany({
            data: plan.map((p) => ({ buyerId: created.id, userId: null, type: p.type, description: p.description, createdAt: p.createdAt })),
          });
          activitiesCreated += plan.length;
        }
      }
    } catch (e) {
      failed++;
      if (batchId) errorLogs.push({ batchId, rowNum, error: String(e).slice(0, 500), rawRow: { ...r } });
    }
  }

  // Persist failure logs + bump batch counters.
  if (batchId) {
    if (errorLogs.length) {
      await prisma.buyerImportLog.createMany({
        data: errorLogs.map((l) => ({ batchId: l.batchId, rowNum: l.rowNum, error: l.error, rawRow: l.rawRow })),
      });
    }
    await prisma.buyerImportBatch.update({
      where: { id: batchId },
      data: { successCount: { increment: imported + updated }, errorCount: { increment: failed } },
    });
  }

  return NextResponse.json({
    imported, updated, skipped, failed,
    activitiesCreated,
    errors: errorLogs.map((l) => ({ row: l.rowNum, error: l.error })),
  });
}

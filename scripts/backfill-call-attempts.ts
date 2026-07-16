// ─────────────────────────────────────────────────────────────────────────────
// backfill-call-attempts.ts — seed the owner-specific call-attempt cycle on
// EXISTING leads (Call Attempt Tracking system, Lalit 2026-07-17)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY
//   The new engine (src/lib/callAttempts.ts) maintains, per lead, an OWNER-
//   SPECIFIC attempt cycle: attemptCount / connectedCount / lastAttemptAt /
//   lastAttemptById, plus the two derived rules —
//     • GHOSTING (Normal Leads): ≥ N attempts, zero meaningful connects, still a
//       workable non-closing status → ghostingAt stamped (👻 secondary tag).
//     • REVIVAL AUTO-RETURN (cold leads): ≥ N attempts, zero connects → record
//       returns to the Admin Revival queue (unassigned, previous owner kept).
//   Existing + Future data standard: existing leads must carry the same counters
//   the engine will maintain going forward, derived from the CallLog history.
//
// WHAT IT COMPUTES (per non-deleted lead with ownerId AND assignedAt set)
//   Over CallLog rows where leadId = lead, userId = lead.ownerId AND
//   startedAt >= lead.assignedAt (the CURRENT owner's cycle only):
//     meaningful (outcome CONNECTED/CALLBACK/INTERESTED/NOT_INTERESTED)
//                → connectedCount
//     everything else (NOT_PICKED/BUSY/SWITCHED_OFF/WRONG_NUMBER)
//                → attemptCount
//     lastAttemptAt   = max(startedAt) across ALL the cycle's calls (any outcome)
//     lastAttemptById = lead.ownerId when a last attempt exists
//
//   GHOSTING stamp (NORMAL leads only): attemptCount >= ghostingThreshold
//     (Setting, default 10) AND connectedCount = 0 AND currentStatus not
//     terminal/closing → ghostingAt = lastAttemptAt (now if somehow null).
//     Never overwrites an existing ghostingAt.
//   REVIVAL RETURN CANDIDATES (cold leads only): attemptCount >=
//     revivalMaxAttempts (Setting, default 5) AND connectedCount = 0 AND status
//     not terminal → LISTED. Counts are written with --apply, but the actual
//     auto-return (mass unassignment) requires the SEPARATE --apply-returns flag
//     so a human sees the dry-run scale first.
//
// SAFETY
//   • DEFAULT = DRY-RUN: reads only, prints the full report, writes NOTHING.
//   • --apply: writes a JSON snapshot of every to-be-touched lead's prior values
//     to backups/ FIRST, then updates in 200-row chunks. Chunk failure falls
//     back to per-row writes — one bad row logs + is skipped; never aborts.
//   • --apply-returns (must accompany --apply): ALSO auto-returns the revival
//     candidates (ownerId→null, previousOwnerId=old owner, returnedToPoolAt=now,
//     revivalCycle=2, followupDate cleared) + one AuditLog row per record.
//   • §4 manual-correction respect: any lead with a LeadFieldHistory row on one
//     of the attempt columns keeps that human-corrected value (field skipped).
//   • NEVER touches remarks / rawImport / conversation history / status.
//   • Column-safe: if the new Lead columns (schema 2026-07-17) are not yet in
//     the prod DB, the DRY-RUN still reports the full plan from CallLog alone;
//     --apply aborts with a clear message until the migration is applied.
//
//   npx tsx scripts/backfill-call-attempts.ts                          # dry-run
//   npx tsx scripts/backfill-call-attempts.ts --apply                  # counts + ghosting
//   npx tsx scripts/backfill-call-attempts.ts --apply --apply-returns  # + auto-returns
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const APPLY_RETURNS = process.argv.includes("--apply-returns");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ── Mirrored constants (scripts stay off the src/ import chain — house rule) ──

// Source: src/lib/callAttempts.ts MEANINGFUL_CALL_OUTCOMES (schema Lead comment).
// A call with one of these outcomes = a real two-way interaction → connectedCount.
const MEANINGFUL_OUTCOMES = ["CONNECTED", "CALLBACK", "INTERESTED", "NOT_INTERESTED"];

// Source: src/lib/lead-statuses.ts CLOSED_OUTCOME_STATUSES (copied verbatim).
const CLOSED_OUTCOME_STATUSES: string[] = [
  "Booked With Us", "Booked with Us",
  "Sell Out", "Sell Off",
  "Leasing", "Rent Out",
  "Already Bought", "Already Booked",
  "Commercial Investment",
  "Purchased Elsewhere", "Booked Through Another Channel",
];

// Source: src/lib/lead-statuses.ts LOST_STATUSES (copied verbatim).
const LOST_STATUSES: string[] = [
  "Not Interested", "War Fear", "Funds Issue", "Not Able To Buy",
  "Broker", "Visited With Other Broker", "In Touch With Another Broker",
  "Other Location", "Other Requirement", "Low Budget", "Just Searching",
  "Drop The Plan", "Number Changed", "Invalid Number",
  "Never Respond Phone Calls", "Never Respond Phone calls",
  "Never Responding", "Pass Away",
  "Junk", "Blocked Me", "By Mistake Inquiry",
  "Other",
  "Lost", "Rejected", "Duplicate", "Out of Scope",
];

// Source: src/lib/lead-statuses.ts TERMINAL_STATUSES = CLOSED + LOST.
const TERMINAL_STATUSES = new Set<string>([...CLOSED_OUTCOME_STATUSES, ...LOST_STATUSES]);

// Source: src/lib/lead-statuses.ts CLOSING_STATUSES (copied verbatim). A lead in
// an engaged/closing stage is NOT ghosting even with many unanswered calls.
const CLOSING_STATUSES = new Set<string>([
  "Site Visit Schedule", "Meeting",
  "Wants Office Visit", "Want Office Visit", "Zoom Meeting",
  "Visit Dubai", "Expo Only",
  "Booked With Us", "Booked with Us",
]);

// Source: src/lib/freshLeads.ts ACTIVE_PIPELINE_ORIGINS (= leadScope.ACTIVE_ORIGINS).
// NORMAL-lead boundary for the ghosting rule: NOT cold-call, and an active-Leads
// origin (null tolerated for legacy rows that predate leadOrigin).
const ACTIVE_PIPELINE_ORIGINS = new Set<string>(["ACTIVE", "ACTIVE_LEAD"]);
function isNormalLead(l: { isColdCall: boolean; leadOrigin: string | null }): boolean {
  return !l.isColdCall && (l.leadOrigin == null || ACTIVE_PIPELINE_ORIGINS.has(l.leadOrigin));
}

// Source: src/lib/leadScope.ts COLD_ORIGINS + cold-calls/page.tsx `originCold`
// (Revival membership = leadOrigin ∈ COLD_ORIGINS OR isColdCall — the page also
// requires rejectedAt null, mirrored below so a rejected cold lead never returns).
const COLD_ORIGINS = new Set<string>(["COLD", "REVIVAL"]);
function isColdLead(l: { isColdCall: boolean; leadOrigin: string | null; rejectedAt: Date | null }): boolean {
  return (l.isColdCall || (l.leadOrigin != null && COLD_ORIGINS.has(l.leadOrigin))) && l.rejectedAt == null;
}

// The new Lead columns this backfill writes (added 2026-07-17). Detected against
// the live DB so a pre-migration dry-run still works end-to-end.
const NEW_COLUMNS = [
  "attemptCount", "connectedCount", "lastAttemptAt", "lastAttemptById",
  "ghostingAt", "revivalCycle", "returnedToPoolAt",
] as const;

// Clamped integer Setting read (string-valued Setting table; bad/unset → default).
async function readIntSetting(key: string, def: number, min: number, max: number): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

type LeadRow = {
  id: string;
  name: string;
  ownerId: string | null;
  assignedAt: Date | null;
  currentStatus: string | null;
  isColdCall: boolean;
  leadOrigin: string | null;
  rejectedAt: Date | null;
  followupDate: Date | null;
  previousOwnerId: string | null;
  owner: { name: string } | null;
};

type Agg = { attempts: number; connected: number; lastAt: Date | null };

type Prior = {
  attemptCount: number | null;
  connectedCount: number | null;
  lastAttemptAt: Date | null;
  lastAttemptById: string | null;
  ghostingAt: Date | null;
  revivalCycle: number | null;
  returnedToPoolAt: Date | null;
};

type Plan = {
  lead: LeadRow;
  computed: Agg;
  prior: Prior | null;            // null = new columns not in DB yet (dry-run only)
  countsChanged: boolean;
  stampGhosting: boolean;         // ghostingAt currently null → stamp lastAt/now
  returnCandidate: boolean;
  preservedFields: string[];      // §4 manually-corrected fields kept as-is
};

const fmtD = (d: Date | null) =>
  d ? d.toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";

async function main() {
  const mode = APPLY ? (APPLY_RETURNS ? "APPLY + APPLY-RETURNS" : "APPLY") : "DRY-RUN";
  console.log(`\n${mode} — owner-specific call-attempt backfill (Lead counters + ghosting + revival returns)\n`);
  if (APPLY_RETURNS && !APPLY) {
    console.error("✗ --apply-returns requires --apply. Nothing done.");
    process.exit(1);
  }

  // Thresholds from Setting (same keys + defaults + ranges as the admin UI).
  const [ghostingThreshold, revivalMaxAttempts] = await Promise.all([
    readIntSetting("ghostingThreshold", 10, 3, 30),
    readIntSetting("revivalMaxAttempts", 5, 2, 15),
  ]);
  console.log(`Thresholds: ghosting=${ghostingThreshold} (Setting ghostingThreshold, default 10) · revivalMax=${revivalMaxAttempts} (Setting revivalMaxAttempts, default 5)`);

  // Do the new Lead columns exist in THIS database yet? (prod can lag schema.prisma
  // — see project-wcr-prod-schema-drift). Dry-run tolerates absence; apply aborts.
  const colRows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'Lead'
       AND column_name IN (${NEW_COLUMNS.map((c) => `'${c}'`).join(",")})`,
  );
  const presentCols = new Set(colRows.map((r) => r.column_name));
  const newColsPresent = NEW_COLUMNS.every((c) => presentCols.has(c));
  console.log(`New Lead columns in DB: ${newColsPresent ? "YES" : `NO (${NEW_COLUMNS.filter((c) => !presentCols.has(c)).join(", ") || "none"} missing)`}`);
  if (APPLY && !newColsPresent) {
    console.error("\n✗ --apply refused: the call-attempt columns are not in this database yet. Apply the migration first.");
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── SCOPE: every non-deleted lead with an owner AND an assignment moment. ──
  // assignedAt anchors the CURRENT owner's cycle window; a lead without it has no
  // derivable owner-cycle and is left untouched (the engine starts it at 0 live).
  const leads: LeadRow[] = await prisma.lead.findMany({
    where: { deletedAt: null, ownerId: { not: null }, assignedAt: { not: null } },
    select: {
      id: true, name: true, ownerId: true, assignedAt: true, currentStatus: true,
      isColdCall: true, leadOrigin: true, rejectedAt: true, followupDate: true,
      previousOwnerId: true, owner: { select: { name: true } },
    },
  });

  // ── ONE grouped pass over CallLog for the whole population (no N+1). ──
  // The join re-states the scope + the per-lead cycle window (userId = ownerId,
  // startedAt >= assignedAt). outcome::text so the enum compares as a string.
  const aggRows = await prisma.$queryRawUnsafe<
    { id: string; attempts: bigint; connected: bigint; last_at: Date | null }[]
  >(
    `SELECT l.id,
            COUNT(*) FILTER (WHERE c."outcome"::text NOT IN (${MEANINGFUL_OUTCOMES.map((o) => `'${o}'`).join(",")})) AS attempts,
            COUNT(*) FILTER (WHERE c."outcome"::text IN (${MEANINGFUL_OUTCOMES.map((o) => `'${o}'`).join(",")})) AS connected,
            MAX(c."startedAt") AS last_at
     FROM "Lead" l
     JOIN "CallLog" c
       ON c."leadId" = l.id
      AND c."userId" = l."ownerId"
      AND c."startedAt" >= l."assignedAt"
     WHERE l."deletedAt" IS NULL AND l."ownerId" IS NOT NULL AND l."assignedAt" IS NOT NULL
     GROUP BY l.id`,
  );
  const aggById = new Map<string, Agg>(
    aggRows.map((r) => [r.id, { attempts: Number(r.attempts), connected: Number(r.connected), lastAt: r.last_at }]),
  );

  // ── Prior values of the new columns (only when they exist) — snapshot input +
  // idempotence check (a re-run writes nothing when values already match). ──
  const priorById = new Map<string, Prior>();
  if (newColsPresent) {
    const priorRows = await prisma.$queryRawUnsafe<
      ({ id: string } & Prior)[]
    >(
      `SELECT id, "attemptCount", "connectedCount", "lastAttemptAt", "lastAttemptById",
              "ghostingAt", "revivalCycle", "returnedToPoolAt"
       FROM "Lead"
       WHERE "deletedAt" IS NULL AND "ownerId" IS NOT NULL AND "assignedAt" IS NOT NULL`,
    );
    for (const r of priorRows) {
      priorById.set(r.id, {
        attemptCount: r.attemptCount == null ? null : Number(r.attemptCount),
        connectedCount: r.connectedCount == null ? null : Number(r.connectedCount),
        lastAttemptAt: r.lastAttemptAt,
        lastAttemptById: r.lastAttemptById,
        ghostingAt: r.ghostingAt,
        revivalCycle: r.revivalCycle == null ? null : Number(r.revivalCycle),
        returnedToPoolAt: r.returnedToPoolAt,
      });
    }
  }

  // ── Build the per-lead plan. ──
  const now = new Date();
  const plans: Plan[] = [];
  for (const l of leads) {
    const computed = aggById.get(l.id) ?? { attempts: 0, connected: 0, lastAt: null };
    const prior = priorById.get(l.id) ?? null;
    const wantLastById = computed.lastAt ? l.ownerId : null;

    // Idempotence: compare to prior (missing columns → compare to engine defaults).
    const p = prior ?? { attemptCount: 0, connectedCount: 0, lastAttemptAt: null, lastAttemptById: null, ghostingAt: null, revivalCycle: 1, returnedToPoolAt: null };
    const countsChanged =
      (p.attemptCount ?? 0) !== computed.attempts ||
      (p.connectedCount ?? 0) !== computed.connected ||
      (p.lastAttemptAt?.getTime() ?? null) !== (computed.lastAt?.getTime() ?? null) ||
      (p.lastAttemptById ?? null) !== wantLastById;

    const status = l.currentStatus ?? "";
    const nonTerminal = !TERMINAL_STATUSES.has(status);
    const ghostingEligible =
      isNormalLead(l) &&
      computed.attempts >= ghostingThreshold &&
      computed.connected === 0 &&
      nonTerminal &&
      !CLOSING_STATUSES.has(status);
    // Stamp only when ghostingAt is currently null — never move an existing stamp.
    const stampGhosting = ghostingEligible && p.ghostingAt == null;

    const returnCandidate =
      isColdLead(l) &&
      computed.attempts >= revivalMaxAttempts &&
      computed.connected === 0 &&
      nonTerminal;

    if (countsChanged || stampGhosting || returnCandidate) {
      plans.push({ lead: l, computed, prior, countsChanged, stampGhosting, returnCandidate, preservedFields: [] });
    }
  }

  // ── §4 MANUAL-CORRECTION GUARD (Lalit: never overwrite a detected human fix).
  // Any lead with a LeadFieldHistory row on one of the attempt columns had that
  // value deliberately corrected — that FIELD is preserved on that lead. ──
  const corrected = await prisma.leadFieldHistory.findMany({
    where: {
      field: { in: [...NEW_COLUMNS] },
      leadId: { in: plans.map((pl) => pl.lead.id) },
    },
    select: { leadId: true, field: true },
  });
  const correctedByLead = new Map<string, Set<string>>();
  for (const c of corrected) {
    if (!correctedByLead.has(c.leadId)) correctedByLead.set(c.leadId, new Set());
    correctedByLead.get(c.leadId)!.add(c.field);
  }
  let preservedCount = 0;
  for (const pl of plans) {
    const set = correctedByLead.get(pl.lead.id);
    if (set && set.size) {
      pl.preservedFields = [...set];
      preservedCount++;
      if (set.has("ghostingAt")) pl.stampGhosting = false;
    }
  }
  if (preservedCount) console.log(`Manually-corrected attempt fields detected → preserved on ${preservedCount} lead(s) (§4).`);

  const countRows = plans.filter((pl) => pl.countsChanged);
  const ghostRows = plans.filter((pl) => pl.stampGhosting);
  const candidateRows = plans.filter((pl) => pl.returnCandidate);
  const withCalls = aggRows.length;

  // ── Report ──
  console.log(`\nLeads scanned (owned + assignedAt set): ${leads.length}`);
  console.log(`Leads with ≥1 call in the owner cycle:  ${withCalls}`);
  console.log(`Counts to set (changed rows):           ${countRows.length}`);
  console.log(`Ghosting stamps (NORMAL leads):         ${ghostRows.length}  (≥${ghostingThreshold} attempts · 0 connects · workable, non-closing status)`);
  console.log(`Revival return CANDIDATES (cold):       ${candidateRows.length}  (≥${revivalMaxAttempts} attempts · 0 connects · non-terminal)`);
  console.log(`Returns applied this run:               ${APPLY && APPLY_RETURNS ? candidateRows.length : 0}${APPLY_RETURNS ? "" : "  (needs --apply --apply-returns)"}`);

  const sample = <T,>(arr: T[], n = 10) => arr.slice(0, n);
  if (countRows.length) {
    console.log(`\n--- Sample count updates (${Math.min(10, countRows.length)} of ${countRows.length}) ---`);
    for (const pl of sample(countRows)) {
      const pr = pl.prior;
      console.log(`  ${pl.lead.name} [${pl.lead.id}] owner=${pl.lead.owner?.name ?? "?"}: attempts ${pr?.attemptCount ?? 0}→${pl.computed.attempts} · connects ${pr?.connectedCount ?? 0}→${pl.computed.connected} · lastAttempt ${fmtD(pl.computed.lastAt)}`);
    }
  }
  if (ghostRows.length) {
    console.log(`\n--- Sample ghosting stamps (${Math.min(10, ghostRows.length)} of ${ghostRows.length}) ---`);
    for (const pl of sample(ghostRows)) {
      console.log(`  👻 ${pl.lead.name} [${pl.lead.id}] owner=${pl.lead.owner?.name ?? "?"} status="${pl.lead.currentStatus ?? "—"}" attempts=${pl.computed.attempts} ghostingAt=${fmtD(pl.computed.lastAt ?? now)}`);
    }
  }
  if (candidateRows.length) {
    const cap = 100;
    console.log(`\n--- Revival auto-return candidates (${Math.min(cap, candidateRows.length)} of ${candidateRows.length} shown) ---`);
    for (const pl of candidateRows.slice(0, cap)) {
      console.log(`  ↩ ${pl.lead.id} · ${pl.lead.name} · owner=${pl.lead.owner?.name ?? "?"} · attempts=${pl.computed.attempts}`);
    }
    if (candidateRows.length > cap) console.log(`  …and ${candidateRows.length - cap} more (full list lands in the --apply snapshot).`);
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to write counts + ghosting stamps` +
      ` (auto-returns additionally need --apply-returns).`);
    await prisma.$disconnect();
    return;
  }
  if (plans.length === 0) {
    console.log(`\n✅ Nothing to do (idempotent).`);
    await prisma.$disconnect();
    return;
  }

  // ── Snapshot BEFORE any write (rollback artifact) — prior values of every
  // to-be-touched lead. Includes ownership + follow-up so --apply-returns is
  // fully reversible from this file alone. ──
  const touched = plans.filter((pl) => pl.countsChanged || pl.stampGhosting || (APPLY_RETURNS && pl.returnCandidate));
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/backfill-call-attempts-${TS}.json`;
  writeFileSync(
    `C:/Users/Lenovo/whitecollar-crm/${file}`,
    JSON.stringify(
      touched.map((pl) => ({
        id: pl.lead.id,
        attemptCount: pl.prior?.attemptCount ?? 0,
        connectedCount: pl.prior?.connectedCount ?? 0,
        lastAttemptAt: pl.prior?.lastAttemptAt?.toISOString() ?? null,
        lastAttemptById: pl.prior?.lastAttemptById ?? null,
        ghostingAt: pl.prior?.ghostingAt?.toISOString() ?? null,
        revivalCycle: pl.prior?.revivalCycle ?? 1,
        returnedToPoolAt: pl.prior?.returnedToPoolAt?.toISOString() ?? null,
        ownerId: pl.lead.ownerId,
        previousOwnerId: pl.lead.previousOwnerId,
        followupDate: pl.lead.followupDate?.toISOString() ?? null,
      })),
      null,
      2,
    ),
  );
  console.log(`\n🔒 Snapshot (${touched.length} leads) → ${file}`);

  // ── Write phase 1: counters + ghosting stamps, 200-row transactions. Chunk
  // failure falls back to per-row so one bad row never aborts the run. ──
  const writable = plans.filter((pl) => pl.countsChanged || pl.stampGhosting);
  let updated = 0;
  const errors: { id: string; name: string; message: string }[] = [];
  const buildData = (pl: Plan) => {
    const skip = new Set(pl.preservedFields); // §4 — human-corrected fields stay
    const data: Record<string, unknown> = {};
    if (pl.countsChanged) {
      if (!skip.has("attemptCount")) data.attemptCount = pl.computed.attempts;
      if (!skip.has("connectedCount")) data.connectedCount = pl.computed.connected;
      if (!skip.has("lastAttemptAt")) data.lastAttemptAt = pl.computed.lastAt;
      if (!skip.has("lastAttemptById")) data.lastAttemptById = pl.computed.lastAt ? pl.lead.ownerId : null;
    }
    if (pl.stampGhosting) data.ghostingAt = pl.computed.lastAt ?? now;
    return data;
  };
  const CHUNK = 200;
  for (let i = 0; i < writable.length; i += CHUNK) {
    const chunk = writable.slice(i, i + CHUNK).filter((pl) => Object.keys(buildData(pl)).length > 0);
    if (chunk.length === 0) continue;
    try {
      await prisma.$transaction(chunk.map((pl) => prisma.lead.update({ where: { id: pl.lead.id }, data: buildData(pl) })));
      updated += chunk.length;
    } catch {
      // Chunk failed — retry row-by-row so only the genuinely bad row is skipped.
      for (const pl of chunk) {
        try {
          await prisma.lead.update({ where: { id: pl.lead.id }, data: buildData(pl) });
          updated++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push({ id: pl.lead.id, name: pl.lead.name, message });
          console.log(`   ✗ skipped ${pl.lead.name} (${pl.lead.id}): ${message}`);
        }
      }
    }
    if ((i / CHUNK) % 5 === 4) console.log(`   …${Math.min(i + CHUNK, writable.length)}/${writable.length} count/ghosting updates`);
  }

  // ── Write phase 2 (--apply-returns only): revival auto-returns + audit rows.
  // Runs AFTER the counters so lastAttemptById was stamped from the still-set
  // ownerId. Each return: unassign, keep previous owner, cycle 2, clear follow-up
  // (terminal-ish transition must not leave an Action-List entry), audit row. ──
  let returned = 0;
  if (APPLY_RETURNS) {
    const RCHUNK = 100;
    for (let i = 0; i < candidateRows.length; i += RCHUNK) {
      const chunk = candidateRows.slice(i, i + RCHUNK);
      for (const pl of chunk) {
        try {
          await prisma.$transaction([
            prisma.lead.update({
              where: { id: pl.lead.id },
              data: {
                ownerId: null,
                previousOwnerId: pl.lead.ownerId,
                returnedToPoolAt: now,
                revivalCycle: 2, // cycle 1 = the first ownership this backfill just closed
                followupDate: null,
                followupReminderSentAt: null, // paired with followupDate (house rule on every clear)
              },
            }),
            prisma.auditLog.create({
              data: {
                userId: null, // system action
                action: "lead.revival.auto-return",
                entity: "Lead",
                entityId: pl.lead.id,
                meta: JSON.stringify({
                  previousOwnerId: pl.lead.ownerId,
                  previousOwnerName: pl.lead.owner?.name ?? null,
                  attemptCount: pl.computed.attempts,
                  connectedCount: pl.computed.connected,
                  threshold: revivalMaxAttempts,
                  source: "historical backfill (scripts/backfill-call-attempts.ts)",
                }),
              },
            }),
          ]);
          returned++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push({ id: pl.lead.id, name: pl.lead.name, message });
          console.log(`   ✗ return skipped ${pl.lead.name} (${pl.lead.id}): ${message}`);
        }
      }
      console.log(`   …${Math.min(i + RCHUNK, candidateRows.length)}/${candidateRows.length} auto-returns`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Count/ghosting rows updated: ${updated}`);
  console.log(`Auto-returns applied:        ${returned}${APPLY_RETURNS ? "" : " (not requested — counts only)"}`);
  console.log(`Errors:                      ${errors.length}`);
  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

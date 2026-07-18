// ─────────────────────────────────────────────────────────────────────────────
// backfill-buyer-calllogs.ts — replay HISTORICAL Buyer-Data calls into the
// centralized CallLog table (Lalit 2026-07-18)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY
//   CallLog is the ONE central call table — Leads / Master Data / Revival all
//   write it (they're all Lead rows, so every row carries leadId). Buyer Data
//   never did: a buyer call was only ever recorded as a BuyerActivity row, so
//   CallLog holds ZERO buyerId rows and the central Call Logs page + CSV export
//   + every CallLog-based call count silently under-reports Buyer Data by
//   ~2.8k calls. The live write path is being fixed separately; THIS script
//   backfills the history so existing data matches the new behaviour
//   (Existing + Future data standard — audit, backfill, future-proof).
//
// WHAT IT CREATES (one CallLog per qualifying BuyerActivity)
//   BuyerActivity.type → CallLog.outcome
//     CALL                    → CONNECTED    (agent spoke to the buyer)
//     ATTEMPT_NOT_PICKED      → NOT_PICKED
//     ATTEMPT_NO_ANSWER       → NOT_PICKED
//     ATTEMPT_WA_NO_RESPONSE  → *** EXCLUDED *** — that's a WhatsApp non-response,
//                               NOT a phone call. It must never inflate call counts.
//
// ── ⚠ TWO COHORTS — READ THIS BEFORE --apply ─────────────────────────────────
//   The 2,776 call-type BuyerActivity rows are NOT all real calls. They split
//   perfectly cleanly (verified 2026-07-18 — zero ambiguous rows in either
//   off-diagonal cell):
//
//     A. REAL agent-logged calls .......... 766   userId SET · no "(imported)" tag
//        (222 CALL · 492 ATTEMPT_NOT_PICKED · 52 ATTEMPT_NO_ANSWER)
//        Genuine calls an agent logged in the Buyer Data UI. THESE are the rows
//        the central CallLog is missing. Backfilled BY DEFAULT.
//
//     B. IMPORT-DERIVED historical notes .. 2010  userId NULL · "(imported)" tag
//        (all type CALL) Synthesized by src/lib/buyerRemarkTimeline.ts from the
//        parsed text of an imported remark cell — "Follow Up (imported)",
//        "Status: Not Interested · … (imported)". NO agent ever placed these
//        calls; they are historical NOTES that the timeline renders as call-ish
//        entries. Writing them into CallLog as CONNECTED would invent 2,010
//        connected calls, inflate every call count/report, and break the
//        invariant that CallLog = real calls (verified: the table currently
//        holds ZERO import-derived rows). It would also repeat the synthetic-
//        CallLog problem the lead side already had to clean up.
//        ⇒ EXCLUDED unless you pass --include-imported (explicit opt-in).
//        When included they are stamped attributedAgentName="Imported" so they
//        self-identify as historical notes under the SAME convention the lead
//        detail already uses (ivrProvider null + attributedAgentName set ⇒ not
//        a real call — see leads/[id]/page.tsx realCallLogs).
//
//   Decision owner: this is a data-meaning call, not a code call. Default =
//   the conservative, reversible option.
//   Column mapping:
//     buyerId     = activity.buyerId          leadId  = null (buyer-linked call)
//     userId      = activity.userId (ACTOR — who performed it, never the owner;
//                   null is preserved → renders "Unknown Agent", never guessed)
//     direction   = OUTBOUND                  (agents call out of Buyer Data)
//     phoneNumber = buyer's FIRST phone (BuyerRecord.phones = JSON string array)
//                   else the literal "(no number)" — the column is NOT NULL
//     notes       = activity.description (undefined when absent → stays null)
//     startedAt   = activity.createdAt        ← the ORIGINAL historical moment,
//                   never now(). This is what every report/date filter reads.
//     durationSec / endedAt / recordingUrl / attributedAgentName → null (unknown
//                   for history; the UI renders "—" rather than inventing a value)
//     ivrProvider → left NULL on purpose: it is a REAL telephony-provider column
//                   (rendered as a chip in the buyer history + counted by
//                   /api/admin/telephony byProvider). A synthetic value there
//                   would pollute both. Only ivrCallId carries our marker.
//
// ── IDEMPOTENCE (3 layers — a re-run can NEVER duplicate) ────────────────────
//   1. DB-ENFORCED (the real guarantee): every created row carries a
//      DETERMINISTIC dedupe key in CallLog.ivrCallId — "buyeract:<activityId>".
//      ivrCallId is @unique in the schema, so a second insert for the same
//      BuyerActivity is physically impossible — even under a concurrent run or
//      a half-finished previous run. Writes use createMany({skipDuplicates:true})
//      so a re-run degrades to a no-op instead of erroring. The key is derived
//      (not random), so it is stable across runs. Collision risk with a genuine
//      provider call id is nil (no provider emits "buyeract:<cuid>"), and no
//      code reads ivrCallId except the two telephony upserts, which look up an
//      exact provider id.
//   2. PRE-PASS SKIP: existing "buyeract:%" keys are loaded up front and skipped
//      in memory, so a re-run REPORTS "already present" cleanly and cheaply
//      rather than firing 2.8k doomed inserts at the unique index.
//   3. CROSS-WRITER GUARD: once the live buyer write path also creates CallLogs,
//      a NEW buyer call produces a CallLog with NO marker. To avoid the backfill
//      duplicating those, each activity is also matched against existing
//      unmarked buyer CallLogs on (buyerId, userId) within ±NEAR_MATCH_MS of
//      startedAt. Matches are CONSUMED (one existing row can absorb exactly one
//      activity), so two rapid attempts can never both collapse onto one row.
//      Today this matches nothing (CallLog has zero buyerId rows) — it exists so
//      a re-run AFTER the live write path ships is still safe.
//
// SAFETY
//   • DEFAULT = DRY-RUN: reads only, prints the full plan, writes NOTHING.
//   • --apply: writes a JSON snapshot of the ENTIRE to-create plan to backups/
//     FIRST, then inserts in chunks. Chunk failure falls back to per-row inserts
//     — one bad row logs + is skipped; the run never aborts.
//   • PURE CREATE: this script never updates or deletes an existing row. It does
//     not touch BuyerActivity, remarks, or any history — the source rows are
//     left exactly as they are (the timeline keeps rendering from them).
//   • Rollback is a one-liner thanks to the deterministic key:
//       DELETE FROM "CallLog" WHERE "ivrCallId" LIKE 'buyeract:%';
//   • FK-safe: an activity whose BuyerRecord no longer exists is skipped.
//     Soft-deleted buyers (deletedAt set) ARE backfilled — the call really
//     happened, the recycle bin is reversible, and every read already filters
//     buyer.deletedAt, so they stay invisible until the buyer is restored.
//     Reported separately so the operator sees the number.
//
//   npx tsx scripts/backfill-buyer-calllogs.ts                      # dry-run
//   npx tsx scripts/backfill-buyer-calllogs.ts --apply              # 766 real calls
//   npx tsx scripts/backfill-buyer-calllogs.ts --include-imported   # dry-run, both cohorts
//   npx tsx scripts/backfill-buyer-calllogs.ts --apply --include-imported  # all 2,776
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient, CallOutcome, CallDirection } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
/** Opt in to cohort B (import-derived historical notes). See the header. */
const INCLUDE_IMPORTED = process.argv.includes("--include-imported");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ── Mirrored constants (scripts stay off the src/ import chain — house rule) ──

// Source: src/lib/buyerLifecycle.ts BUYER_ACTIVITY_TYPE. The THREE phone-call
// activity kinds and the CallOutcome each maps to. ATTEMPT_WA_NO_RESPONSE is
// deliberately absent — a WhatsApp non-response is not a call.
const CALL_TYPE_OUTCOME: Record<string, CallOutcome> = {
  CALL: CallOutcome.CONNECTED,
  ATTEMPT_NOT_PICKED: CallOutcome.NOT_PICKED,
  ATTEMPT_NO_ANSWER: CallOutcome.NOT_PICKED,
};
const CALL_TYPES = Object.keys(CALL_TYPE_OUTCOME);

/** Deterministic dedupe key: one BuyerActivity ⇒ at most one CallLog, forever. */
const MARKER_PREFIX = "buyeract:";
const markerFor = (activityId: string) => `${MARKER_PREFIX}${activityId}`;

/** Tolerance for layer-3 (live write path wrote the CallLog moments apart). */
const NEAR_MATCH_MS = 2000;

/** Placeholder for the NOT-NULL phoneNumber column when the buyer has no phone. */
const NO_NUMBER = "(no number)";

// Source: src/lib/buyerRemarkTimeline.ts IMPORTED_TAG. Every BuyerActivity that
// was SYNTHESIZED from imported remark text carries this tag in its description.
// Combined with a null actor it identifies cohort B exactly (verified: 0 rows sit
// in either off-diagonal cell — tagged-with-actor or untagged-without-actor).
const IMPORTED_TAG = "(imported)";
const isImportDerived = (userId: string | null, description: string | null) =>
  userId == null && (description ?? "").includes(IMPORTED_TAG);

/** Agent label stamped on cohort-B rows so they self-identify as historical notes
 *  (ivrProvider null + attributedAgentName set = the lead side's "not a real call"
 *  shape). Never applied to a real agent-logged call. */
const IMPORTED_AGENT_LABEL = "Imported";

// Source: src/lib/moduleSource.ts buyerSourceModule — reporting label only.
const buyerModule = (market: string | null) =>
  market === "India" ? "India Buyer Data" : "Dubai Buyer Data";

// Source: src/app/(app)/call-logs/page.tsx firstBuyerPhone — BuyerRecord.phones is
// a JSON array of strings (["+9715…", …]); tolerate a bare string for legacy rows.
function firstBuyerPhone(phones: string | null): string | null {
  if (!phones) return null;
  try {
    const arr = JSON.parse(phones);
    if (Array.isArray(arr)) {
      const first = arr.map((p) => String(p ?? "").trim()).find(Boolean);
      return first ?? null;
    }
  } catch {
    /* not JSON — fall through to the raw string */
  }
  const t = phones.trim();
  return t || null;
}

type ActivityRow = {
  id: string;
  buyerId: string;
  userId: string | null;
  type: string;
  description: string | null;
  createdAt: Date;
};

type BuyerRow = {
  id: string;
  clientName: string;
  phones: string | null;
  market: string;
  deletedAt: Date | null;
};

type NewCall = {
  activityId: string;
  dedupeKey: string;
  buyerId: string;
  buyerName: string;
  module: string;
  userId: string | null;
  actorName: string;
  phoneNumber: string;
  hasPhone: boolean;
  outcome: CallOutcome;
  type: string;
  notes: string | null;
  startedAt: Date;
  buyerDeleted: boolean;
  /** true = cohort B (synthesized from an imported remark, not a real call). */
  imported: boolean;
};

const fmtD = (d: Date | null) =>
  d ? d.toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — historical Buyer-Data calls → central CallLog`);
  console.log(
    `Cohorts: REAL agent-logged calls = ALWAYS · import-derived historical notes = ${
      INCLUDE_IMPORTED ? "INCLUDED (--include-imported)" : "EXCLUDED (pass --include-imported to include)"
    }\n`,
  );

  // ── 1. SOURCE: every phone-call BuyerActivity, oldest first. ───────────────
  const activities: ActivityRow[] = await prisma.buyerActivity.findMany({
    where: { type: { in: CALL_TYPES } },
    orderBy: { createdAt: "asc" },
    select: { id: true, buyerId: true, userId: true, type: true, description: true, createdAt: true },
  });

  // Full type census (incl. the EXCLUDED WhatsApp kind) so the operator can see
  // exactly what was and wasn't treated as a call.
  const census = await prisma.buyerActivity.groupBy({
    by: ["type"],
    where: { type: { in: [...CALL_TYPES, "ATTEMPT_WA_NO_RESPONSE"] } },
    _count: { _all: true },
  });
  console.log("BuyerActivity census:");
  for (const c of census.sort((a, b) => b._count._all - a._count._all)) {
    const included = CALL_TYPES.includes(c.type);
    console.log(
      `  ${c.type.padEnd(24)} ${String(c._count._all).padStart(5)}  ${
        included ? `→ ${CALL_TYPE_OUTCOME[c.type]}` : "→ EXCLUDED (WhatsApp non-response, not a call)"
      }`,
    );
  }

  // ── 2. Referenced buyers (FK safety + name / phone / market). ──────────────
  const buyerIds = [...new Set(activities.map((a) => a.buyerId))];
  const buyers: BuyerRow[] = await prisma.buyerRecord.findMany({
    where: { id: { in: buyerIds } },
    select: { id: true, clientName: true, phones: true, market: true, deletedAt: true },
  });
  const buyerById = new Map(buyers.map((b) => [b.id, b]));

  // Actor names (report readability only — never used to guess a missing actor).
  const userIds = [...new Set(activities.map((a) => a.userId).filter((u): u is string => !!u))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const userById = new Map(users.map((u) => [u.id, u.name]));

  // ── 3. Existing buyer-linked CallLogs → idempotence layers 2 + 3. ──────────
  const existing = await prisma.callLog.findMany({
    where: { buyerId: { not: null } },
    select: { id: true, buyerId: true, userId: true, startedAt: true, ivrCallId: true },
  });
  const markerSet = new Set(
    existing.map((c) => c.ivrCallId).filter((k): k is string => !!k && k.startsWith(MARKER_PREFIX)),
  );
  // Consumable pool of UNMARKED buyer calls (i.e. written by the live path), keyed
  // by buyer+actor. Sorted so the nearest-in-time candidate is found predictably.
  const poolKey = (buyerId: string, userId: string | null) => `${buyerId}|${userId ?? ""}`;
  const pool = new Map<string, { at: number; used: boolean }[]>();
  for (const c of existing) {
    if (!c.buyerId) continue;
    if (c.ivrCallId && c.ivrCallId.startsWith(MARKER_PREFIX)) continue; // ours already
    const k = poolKey(c.buyerId, c.userId);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push({ at: c.startedAt.getTime(), used: false });
  }
  for (const list of pool.values()) list.sort((a, b) => a.at - b.at);

  console.log(
    `\nExisting buyer-linked CallLog rows: ${existing.length}` +
      ` (marked by a previous run of this script: ${markerSet.size} · unmarked/live-written: ${existing.length - markerSet.size})`,
  );

  // ── 4. Build the plan. ─────────────────────────────────────────────────────
  const toCreate: NewCall[] = [];
  let skippedExistingMarker = 0;
  let skippedExistingNear = 0;
  let skippedNoBuyer = 0;
  let cohortReal = 0;
  let cohortImported = 0;
  let skippedImported = 0;
  const missingBuyerIds = new Set<string>();

  for (const a of activities) {
    // ── Cohort split (see the header). A real agent-logged call always counts;
    // an import-derived historical note only with the explicit opt-in. ──
    const imported = isImportDerived(a.userId, a.description);
    if (imported) cohortImported++;
    else cohortReal++;
    if (imported && !INCLUDE_IMPORTED) {
      skippedImported++;
      continue;
    }

    const buyer = buyerById.get(a.buyerId);
    if (!buyer) {
      // FK safety — the BuyerRecord was hard-deleted; an insert would violate the FK.
      skippedNoBuyer++;
      missingBuyerIds.add(a.buyerId);
      continue;
    }

    // Layer 2 — this exact activity already has its CallLog.
    if (markerSet.has(markerFor(a.id))) {
      skippedExistingMarker++;
      continue;
    }

    // Layer 3 — an unmarked CallLog for the same buyer+actor sits within the
    // tolerance window ⇒ the live write path already recorded this call. Consume it.
    const candidates = pool.get(poolKey(a.buyerId, a.userId));
    if (candidates) {
      const t = a.createdAt.getTime();
      const hit = candidates.find((c) => !c.used && Math.abs(c.at - t) <= NEAR_MATCH_MS);
      if (hit) {
        hit.used = true;
        skippedExistingNear++;
        continue;
      }
    }

    const phone = firstBuyerPhone(buyer.phones);
    toCreate.push({
      activityId: a.id,
      dedupeKey: markerFor(a.id),
      buyerId: a.buyerId,
      buyerName: buyer.clientName,
      module: buyerModule(buyer.market),
      userId: a.userId,
      actorName: a.userId ? userById.get(a.userId) ?? "Unknown Agent" : "Unknown Agent",
      phoneNumber: phone ?? NO_NUMBER,
      hasPhone: !!phone,
      outcome: CALL_TYPE_OUTCOME[a.type],
      type: a.type,
      notes: a.description,
      startedAt: a.createdAt, // PRESERVE the original moment — historical data
      buyerDeleted: buyer.deletedAt != null,
      imported,
    });
  }

  // ── 5. Report the plan. ────────────────────────────────────────────────────
  const byType = new Map<string, number>();
  const byModule = new Map<string, number>();
  let noPhone = 0;
  let noActor = 0;
  let deletedBuyer = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  for (const c of toCreate) {
    byType.set(c.type, (byType.get(c.type) ?? 0) + 1);
    byModule.set(c.module, (byModule.get(c.module) ?? 0) + 1);
    if (!c.hasPhone) noPhone++;
    if (!c.userId) noActor++;
    if (c.buyerDeleted) deletedBuyer++;
    if (!oldest || c.startedAt < oldest) oldest = c.startedAt;
    if (!newest || c.startedAt > newest) newest = c.startedAt;
  }

  console.log(`\n--- Cohorts ---`);
  console.log(`A · REAL agent-logged calls:         ${cohortReal}   (userId set · no "${IMPORTED_TAG}" tag) → always backfilled`);
  console.log(
    `B · import-derived historical notes: ${cohortImported}   (userId null · "${IMPORTED_TAG}" tag) → ${
      INCLUDE_IMPORTED ? "INCLUDED this run" : "EXCLUDED this run"
    }`,
  );
  if (!INCLUDE_IMPORTED && cohortImported) {
    console.log(`    ⚠ Cohort B was NOT placed by any agent — it is imported remark text rendered as`);
    console.log(`      call-ish timeline entries. Writing it to CallLog would invent ${cohortImported} CONNECTED`);
    console.log(`      calls and inflate every call count. Pass --include-imported ONLY if the owner`);
    console.log(`      explicitly wants CallLog to mirror BuyerActivity 1:1.`);
  }

  console.log(`\n--- Plan ---`);
  console.log(`Activities scanned (3 call types):   ${activities.length}`);
  console.log(`Distinct buyers referenced:          ${buyerIds.length} (found ${buyers.length})`);
  console.log(`CallLog rows to create:              ${toCreate.length}`);
  console.log(`Skipped — cohort B (imported):       ${skippedImported}`);
  console.log(`Skipped — already backfilled (key):  ${skippedExistingMarker}`);
  console.log(`Skipped — live CallLog within ${NEAR_MATCH_MS}ms: ${skippedExistingNear}`);
  console.log(`Skipped — buyer no longer exists:    ${skippedNoBuyer}${missingBuyerIds.size ? ` (${missingBuyerIds.size} distinct buyerId)` : ""}`);
  console.log(`\nBreakdown of the rows to create:`);
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(24)} ${String(n).padStart(5)} → ${CALL_TYPE_OUTCOME[t]}`);
  }
  for (const [m, n] of [...byModule].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(24)} ${String(n).padStart(5)}`);
  }
  console.log(`\nData-quality flags (created anyway — history is preserved verbatim):`);
  console.log(`  no phone on buyer → "${NO_NUMBER}": ${noPhone}`);
  console.log(`  no actor (userId null) → "${IMPORTED_AGENT_LABEL}"/"Unknown Agent": ${noActor}`);
  console.log(`  buyer is soft-deleted (hidden until restored): ${deletedBuyer}`);
  console.log(`  date range: ${fmtD(oldest)} … ${fmtD(newest)}`);

  const samples = toCreate.slice(0, 10);
  if (samples.length) {
    console.log(`\n--- Sample rows (${samples.length} of ${toCreate.length}) ---`);
    for (const c of samples) {
      console.log(
        `  ${fmtD(c.startedAt)} · ${c.buyerName} [${c.module}] · ${c.imported ? IMPORTED_AGENT_LABEL : c.actorName} · ${c.phoneNumber} · ${c.type}→${c.outcome}${c.imported ? " · COHORT-B" : ""} · key=${c.dedupeKey}`,
      );
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to create ${toCreate.length} CallLog row(s).`);
    await prisma.$disconnect();
    return;
  }
  if (toCreate.length === 0) {
    console.log(`\n✅ Nothing to do (idempotent — every buyer call already has its CallLog).`);
    await prisma.$disconnect();
    return;
  }

  // ── 6. Snapshot BEFORE any write. This is a pure-CREATE backfill, so the
  // snapshot is the full list of rows about to appear (+ their dedupe keys) —
  // everything needed to audit or reverse the run. ──
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/backfill-buyer-calllogs-${TS}.json`;
  writeFileSync(
    `C:/Users/Lenovo/whitecollar-crm/${file}`,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        script: "scripts/backfill-buyer-calllogs.ts",
        rollbackSql: `DELETE FROM "CallLog" WHERE "ivrCallId" LIKE '${MARKER_PREFIX}%';`,
        includedImportedCohort: INCLUDE_IMPORTED,
        cohortRealTotal: cohortReal,
        cohortImportedTotal: cohortImported,
        existingBuyerCallLogsBefore: existing.length,
        rows: toCreate.map((c) => ({
          dedupeKey: c.dedupeKey,
          activityId: c.activityId,
          buyerId: c.buyerId,
          buyerName: c.buyerName,
          module: c.module,
          userId: c.userId,
          phoneNumber: c.phoneNumber,
          outcome: c.outcome,
          sourceType: c.type,
          importDerived: c.imported,
          startedAt: c.startedAt.toISOString(),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\n🔒 Snapshot (${toCreate.length} planned rows) → ${file}`);
  console.log(`   Rollback: DELETE FROM "CallLog" WHERE "ivrCallId" LIKE '${MARKER_PREFIX}%';`);

  // ── 7. Write. createMany + skipDuplicates leans on the ivrCallId unique index,
  // so even a concurrent/partial previous run can only ever produce ONE row per
  // activity. A failed chunk retries per-row so a single bad row is skipped, not
  // the whole batch. ──
  const row = (c: NewCall) => ({
    buyerId: c.buyerId,
    leadId: null,
    userId: c.userId,
    direction: CallDirection.OUTBOUND,
    phoneNumber: c.phoneNumber,
    outcome: c.outcome,
    notes: c.notes ?? undefined,
    startedAt: c.startedAt,
    // Cohort B self-identifies as a historical note under the lead side's existing
    // convention (ivrProvider null + attributedAgentName set ⇒ not a real call).
    // Cohort A leaves it null so the real actor renders from user.name.
    attributedAgentName: c.imported ? IMPORTED_AGENT_LABEL : undefined,
    ivrCallId: c.dedupeKey, // deterministic + @unique ⇒ duplicates impossible
  });

  const CHUNK = 200;
  let created = 0;
  let skippedDup = 0;
  const errors: { activityId: string; buyerName: string; message: string }[] = [];

  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const chunk = toCreate.slice(i, i + CHUNK);
    try {
      const res = await prisma.callLog.createMany({ data: chunk.map(row), skipDuplicates: true });
      created += res.count;
      skippedDup += chunk.length - res.count;
    } catch {
      // Chunk failed — retry row-by-row so only the genuinely bad row is skipped.
      for (const c of chunk) {
        try {
          const res = await prisma.callLog.createMany({ data: [row(c)], skipDuplicates: true });
          created += res.count;
          skippedDup += 1 - res.count;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          errors.push({ activityId: c.activityId, buyerName: c.buyerName, message });
          console.log(`   ✗ skipped ${c.buyerName} (activity ${c.activityId}): ${message}`);
        }
      }
    }
    if ((i / CHUNK) % 5 === 4) console.log(`   …${Math.min(i + CHUNK, toCreate.length)}/${toCreate.length} inserted`);
  }

  // ── 8. Verify what actually landed (independent re-count, not a trusted tally). ──
  const after = await prisma.callLog.count({ where: { buyerId: { not: null } } });

  console.log(`\n--- Summary ---`);
  console.log(`CallLog rows created:            ${created}`);
  console.log(`Skipped as duplicates at write:  ${skippedDup} (unique ivrCallId — safe re-run)`);
  console.log(`Skipped before write:            ${skippedExistingMarker + skippedExistingNear} existing · ${skippedNoBuyer} missing buyer`);
  console.log(`Errors:                          ${errors.length}`);
  console.log(`Buyer-linked CallLog rows now:   ${after} (was ${existing.length})`);
  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

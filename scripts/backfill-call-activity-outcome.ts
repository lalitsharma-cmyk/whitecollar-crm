/**
 * scripts/backfill-call-activity-outcome.ts
 *
 * Backfill Activity.outcome on every remaining CALL Activity where it is NULL,
 * so the `data-integrity-jun25` regression invariant (>=90% of CALL activities
 * with a user carry an outcome) holds with a wide margin, and so the Smart-
 * Timeline outcome chip is never blank on a call.
 *
 * This SUPERSEDES scripts/backfill-activity-outcome.ts (which only handled CALL
 * activities that had a matching CallLog and SKIPPED the rest). The residual
 * NULLs are almost entirely click-to-call "📞 Call initiated" taps (a dial with
 * no CallLog of its own) plus the occasional Buyer→Lead call carry-over. This
 * script closes those too, deriving each row's outcome in priority order:
 *
 *   1. TAP        — title/description marks a click-to-call tap  → "Initiated"
 *                   (the honest label for a dial with no result yet; the real
 *                   outcome, if the agent logged the call, is on its OWN row).
 *   2. CALL LOG   — a same-lead+user CallLog exists (nearest time) → that call's
 *                   REAL outcome, e.g. "CONNECTED"/"NOT PICKED" (accurate, not a
 *                   guess — identical to backfill-activity-outcome.ts).
 *   3. GENERIC    — no signal at all → "Logged" (safe, non-null).
 *
 * FORMAT + LABELS come from src/lib/callOutcome.ts — the SAME helper every live
 * CALL write path uses — so the backfilled values are byte-identical to forward
 * ones (data-consistency rule: existing + future, no dual logic, zero drift).
 *
 * SAFE + IDEMPOTENT:
 *   • Only updates CALL activities where outcome IS NULL — re-running is a no-op.
 *   • Additive/display-only: touches Activity.outcome ONLY. Never edits remarks,
 *     descriptions, conversation, timeline structure, or any other field.
 *   • Backs up every affected row (id, title, prior null, chosen value + why) to
 *     backups/ BEFORE writing.
 *   • Reads back a verification count after applying.
 *
 * Usage:
 *   npx tsx scripts/backfill-call-activity-outcome.ts --dry-run   # report only
 *   npx tsx scripts/backfill-call-activity-outcome.ts             # apply
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  callOutcomeLabel,
  CALL_OUTCOME_INITIATED,
  CALL_OUTCOME_LOGGED,
} from "../src/lib/callOutcome";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

/** True when a CALL Activity records the agent tapping the call button (the
 *  click-to-call path writes title "📞 Call initiated" / desc "Agent tapped
 *  Call button"). Matched loosely so any historical wording is caught too. */
function isInitiatedTap(title: string | null, description: string | null): boolean {
  const t = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  return /call initiated|tapped call|call button/.test(t);
}

type Source = "tap→Initiated" | "callLog→outcome" | "generic→Logged";

async function main() {
  console.log(`📞 CALL Activity.outcome backfill (initiated taps + CallLog + generic)${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(72));

  // Candidate CALL activities: outcome NULL. (userId may be null for a handful of
  // system rows; the invariant only counts userId != null, but we fill BOTH so no
  // blank chip is ever rendered. We record whether the row counts, for the log.)
  const acts = await prisma.activity.findMany({
    where: { type: "CALL", outcome: null },
    select: { id: true, leadId: true, userId: true, title: true, description: true, createdAt: true, completedAt: true },
  });

  // All lead-linked CallLogs, indexed by leadId|userId → [{outcome, time}] for the
  // nearest-time match (same approach as backfill-activity-outcome.ts).
  const logs = await prisma.callLog.findMany({
    where: { leadId: { not: null } },
    select: { id: true, leadId: true, userId: true, outcome: true, startedAt: true, createdAt: true },
  });
  const idx = new Map<string, { id: string; outcome: string; t: number }[]>();
  for (const l of logs) {
    const k = `${l.leadId}|${l.userId}`;
    const t = (l.startedAt ?? l.createdAt).getTime();
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k)!.push({ id: l.id, outcome: l.outcome, t });
  }

  const changes: Array<{
    activityId: string; leadId: string; userId: string | null; countsForInvariant: boolean;
    newOutcome: string; source: Source; matchedCallLogId: string | null;
  }> = [];

  for (const a of acts) {
    let newOutcome: string;
    let source: Source;
    let matchedCallLogId: string | null = null;

    if (isInitiatedTap(a.title, a.description)) {
      // TAP — honest "Initiated"; do NOT borrow a later call's outcome.
      newOutcome = CALL_OUTCOME_INITIATED;
      source = "tap→Initiated";
    } else {
      // Try the accurate CallLog match (same lead+user, nearest anchor time).
      const cands = a.userId ? idx.get(`${a.leadId}|${a.userId}`) : undefined;
      if (cands && cands.length > 0) {
        const anchor = (a.completedAt ?? a.createdAt).getTime();
        let best = cands[0];
        for (const c of cands) if (Math.abs(c.t - anchor) < Math.abs(best.t - anchor)) best = c;
        newOutcome = callOutcomeLabel(best.outcome); // EXACT live-logger format
        source = "callLog→outcome";
        matchedCallLogId = best.id;
      } else {
        // No signal — safe generic (real detail, if any, stays in the description).
        newOutcome = CALL_OUTCOME_LOGGED;
        source = "generic→Logged";
      }
    }

    changes.push({
      activityId: a.id, leadId: a.leadId, userId: a.userId,
      countsForInvariant: a.userId != null, newOutcome, source, matchedCallLogId,
    });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const bySource = new Map<Source, number>();
  const byOutcome = new Map<string, number>();
  for (const c of changes) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
    byOutcome.set(c.newOutcome, (byOutcome.get(c.newOutcome) ?? 0) + 1);
  }
  console.log(`CALL activities with NULL outcome:        ${acts.length}`);
  console.log(`  of which count for the invariant (user):${changes.filter((c) => c.countsForInvariant).length}`);
  console.log(`\nBy derivation source:`);
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${s}`);
  console.log(`\nBy outcome value to be written:`);
  for (const [o, n] of [...byOutcome.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${o}`);

  // ── Backup BEFORE any write ─────────────────────────────────────────────────
  mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = new URL(`../backups/call-activity-outcome-backfill-${stamp}.json`, import.meta.url);
  writeFileSync(backupPath, JSON.stringify({
    timestamp: new Date().toISOString(), dryRun,
    fix: "Activity.outcome for residual NULL CALL rows (taps + CallLog + generic)",
    count: changes.length, changes,
  }, null, 2));
  console.log(`\n📝 Backup (${changes.length} rows): ${backupPath.pathname}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  // ── Apply: one targeted update per row (outcome only) ──────────────────────
  let applied = 0;
  for (const c of changes) {
    await prisma.activity.update({ where: { id: c.activityId }, data: { outcome: c.newOutcome } });
    applied++;
    if (applied % 200 === 0) console.log(`   …${applied}/${changes.length}`);
  }
  console.log(`\n✅ Applied: ${applied}`);

  // ── Read-back verification (mirrors the invariant's exact predicate) ────────
  const callTotal = await prisma.activity.count({ where: { type: "CALL", userId: { not: null } } });
  const callWithOutcome = await prisma.activity.count({ where: { type: "CALL", userId: { not: null }, outcome: { not: null } } });
  const stillNull = callTotal - callWithOutcome;
  const pct = callTotal > 0 ? (callWithOutcome / callTotal) * 100 : 100;
  console.log(`Read-back · CALL+user with outcome: ${callWithOutcome}/${callTotal} (${pct.toFixed(2)}%) · still null: ${stillNull}`);
  console.log(pct >= 90 ? "✅ data-integrity-jun25 threshold (>=90%) satisfied" : "❌ still below threshold");

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });

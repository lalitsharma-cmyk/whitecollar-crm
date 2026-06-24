/**
 * scripts/backfill-activity-outcome.ts
 *
 * FIX 1 (data-integrity batch 2026-06-25): backfill Activity.outcome on
 * historical CALL activities from the matching CallLog's recorded outcome.
 *
 * WHY: the code that stamps `Activity.outcome` on a logged call only shipped
 * 2026-06-24 ~22:00. Every CALL activity created before then has outcome = NULL,
 * so the Smart-Timeline outcome chip is blank on all old calls. The call's REAL
 * outcome is recorded on its CallLog row, so we copy it across — an ACCURATE
 * value (that call's actual outcome), not a guess.
 *
 * MATCHING: a CALL Activity is matched to a CallLog with the SAME leadId AND
 * SAME userId, picking the CallLog whose time (startedAt ?? createdAt) is
 * NEAREST the activity's anchor (completedAt ?? createdAt). Activities with no
 * same-lead+user CallLog are left untouched (cannot derive accurately).
 *
 * FORMAT: stored EXACTLY as the live logger writes it —
 * `CallLog.outcome.replaceAll("_", " ")` (e.g. "NOT PICKED", "CONNECTED") — so
 * historical chips render identically to forward ones. See
 * src/app/api/leads/[id]/log-call/route.ts (Activity.outcome assignment).
 *
 * NOT BACKFILLED (accepted forward-only limitation — documented, not a miss):
 *   • Activity.followupDate  — stamping the lead's CURRENT followupDate onto an
 *     old activity would be FABRICATED (that wasn't the follow-up set at the
 *     time). Left null on history; populates correctly going forward.
 *   • Activity.actionContext — same reasoning; cannot be reconstructed.
 *
 * SAFE + IDEMPOTENT:
 *   • Only updates CALL activities where outcome IS NULL — re-running is a no-op.
 *   • Backs up every affected Activity (id, prior outcome=null, matched CallLog
 *     id + chosen value) to backups/ BEFORE writing.
 *   • Reads back a verification count after applying.
 *
 * Usage:
 *   npx tsx scripts/backfill-activity-outcome.ts --dry-run   # report only
 *   npx tsx scripts/backfill-activity-outcome.ts             # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`📞 Activity.outcome backfill from CallLog${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(64));

  // Candidate CALL activities: outcome NULL + a userId to match a CallLog on.
  const acts = await prisma.activity.findMany({
    where: { type: "CALL", outcome: null, userId: { not: null } },
    select: { id: true, leadId: true, userId: true, createdAt: true, completedAt: true },
  });
  // All lead-linked CallLogs, indexed by leadId|userId.
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

  const changes: Array<{ activityId: string; leadId: string; userId: string; oldOutcome: null; newOutcome: string; matchedCallLogId: string; deltaMs: number }> = [];
  let noMatch = 0;
  for (const a of acts) {
    const cands = idx.get(`${a.leadId}|${a.userId}`);
    if (!cands || cands.length === 0) { noMatch++; continue; }
    const anchor = (a.completedAt ?? a.createdAt).getTime();
    let best = cands[0];
    for (const c of cands) if (Math.abs(c.t - anchor) < Math.abs(best.t - anchor)) best = c;
    // EXACT same format the live logger persists (enum token, underscores → spaces).
    const newOutcome = best.outcome.replaceAll("_", " ");
    changes.push({ activityId: a.id, leadId: a.leadId, userId: a.userId!, oldOutcome: null, newOutcome, matchedCallLogId: best.id, deltaMs: best.t - anchor });
  }

  console.log(`CALL activities with NULL outcome:     ${acts.length}`);
  console.log(`  → matched to a CallLog (will set):   ${changes.length}`);
  console.log(`  → no same-lead+user CallLog (skip):  ${noMatch}`);
  const dist = new Map<string, number>();
  for (const c of changes) dist.set(c.newOutcome, (dist.get(c.newOutcome) ?? 0) + 1);
  console.log(`  outcome distribution to be written:`);
  for (const [o, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${o.padEnd(16)} ${n}`);

  // Backup BEFORE any write.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/activity-outcome-backfill-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, fix: "FIX1 Activity.outcome from CallLog", count: changes.length, skippedNoMatch: noMatch, changes }, null, 2));
  console.log(`\n📝 Backup (${changes.length} rows): ${backupPath}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  // Apply in chunks; one targeted update per activity (outcome only).
  let applied = 0;
  for (const c of changes) {
    await prisma.activity.update({ where: { id: c.activityId }, data: { outcome: c.newOutcome } });
    applied++;
    if (applied % 200 === 0) console.log(`   …${applied}/${changes.length}`);
  }
  console.log(`\n✅ Applied: ${applied}`);

  // Read-back verification.
  const stillNull = await prisma.activity.count({ where: { type: "CALL", outcome: null, userId: { not: null } } });
  const nowSet = await prisma.activity.count({ where: { type: "CALL", outcome: { not: null } } });
  console.log(`Read-back · CALL activities now WITH outcome: ${nowSet}`);
  console.log(`Read-back · CALL+user activities STILL null (only unmatched should remain): ${stillNull} (expected == ${noMatch})`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });

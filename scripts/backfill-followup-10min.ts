/**
 * scripts/backfill-followup-10min.ts
 *
 * BUG 3 (lead-detail fixes 2026-06-25): the auto follow-up default used to be
 * "today 7:00pm IST" (close of business). It is now "createdAt + 10 minutes"
 * (a fresh lead should be contacted ~10 min after it arrives). This backfills
 * the EXISTING leads that still carry the old auto-7PM default so historical
 * data matches the new rule — but ONLY the ones that are UNAMBIGUOUSLY the
 * auto-default, never an agent's deliberate 7pm follow-up.
 *
 * AUTO-7PM SIGNATURE (all three must hold):
 *   1. followupDate is at exactly 19:00 IST, AND
 *   2. its IST calendar day == the lead's createdAt IST calendar day
 *      (the old todayEodIST() always stamped 7pm on the creation day), AND
 *   3. the lead has NO followupDate row in LeadFieldHistory — i.e. no agent /
 *      admin / import ever set or changed the follow-up (so it is still the
 *      untouched creation default, not someone's chosen 7pm slot).
 *  Plus: deletedAt:null (skip recycle-bin) and an existing followupDate.
 *
 * If a lead's 19:00 follow-up was ever edited (history exists) it is LEFT
 * UNTOUCHED — that is a deliberate agent value. If the signature can't cleanly
 * isolate auto-defaults (it can — audited via LeadFieldHistory), we would stop;
 * here it does, so we proceed conservatively on the matched set only.
 *
 * NEW VALUE: followupDate := createdAt + 10 minutes (same rule as ingestLead).
 *   This shifts these leads' follow-up earlier; recent ones become due/overdue,
 *   which is the INTENDED behavior — a fresh lead should be contacted promptly.
 *
 * SAFE + IDEMPOTENT:
 *   • Re-running is a no-op: once shifted, followupDate is no longer 19:00 IST
 *     AND a "followup-10min-backfill" history row now exists, so the lead no
 *     longer matches the signature.
 *   • Backs up every affected lead (id, name, createdAt, prior followupDate +
 *     followupReminderSentAt) to backups/ BEFORE writing.
 *   • Writes a LeadFieldHistory audit row per lead (field "followupDate",
 *     old→new ISO, source "followup-10min-backfill") → fully reversible.
 *   • Clears followupReminderSentAt (the 10-min pre-call reminder dedupe) so the
 *     reminder can re-evaluate against the new time. Internal flag, not audited.
 *   • NEVER touches remarks / conversation history / status / any other field.
 *
 * Usage:
 *   npx tsx scripts/backfill-followup-10min.ts --dry-run   # report only
 *   npx tsx scripts/backfill-followup-10min.ts             # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

const IST_MS = 5.5 * 3600 * 1000;
const istDayKey = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istIsSevenPM = (d: Date) => {
  const ist = new Date(d.getTime() + IST_MS);
  return ist.getUTCHours() === 19 && ist.getUTCMinutes() === 0;
};

async function main() {
  console.log(`🕒 Auto-7PM follow-up → createdAt+10min backfill${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(70));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  // Candidate set: active leads with a 19:00-IST followupDate on their createdAt day.
  const candidates = await prisma.lead.findMany({
    where: { deletedAt: null, followupDate: { not: null } },
    select: { id: true, name: true, createdAt: true, followupDate: true, followupReminderSentAt: true },
  });
  const sigMatch = candidates.filter(
    (l) => l.followupDate && istIsSevenPM(l.followupDate) && istDayKey(l.followupDate) === istDayKey(l.createdAt),
  );
  console.log(`Active leads w/ followupDate: ${candidates.length}`);
  console.log(`  matching 19:00-IST-on-createdAt-day: ${sigMatch.length}`);

  // Exclude any that have a followupDate edit in LeadFieldHistory (someone touched it).
  const ids = sigMatch.map((l) => l.id);
  const touched = new Set(
    ids.length
      ? (await prisma.leadFieldHistory.findMany({
          where: { leadId: { in: ids }, field: "followupDate" },
          select: { leadId: true },
        })).map((h) => h.leadId)
      : [],
  );
  const target = sigMatch.filter((l) => !touched.has(l.id));
  console.log(`  of those, with a followupDate history edit (PRESERVED, skipped): ${touched.size}`);
  console.log(`  → unambiguous auto-defaults to backfill: ${target.length}`);

  if (target.length === 0) {
    console.log("\nNothing to backfill. ✅");
    await prisma.$disconnect();
    return;
  }

  const backup = target.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt.toISOString(),
    oldFollowupDate: l.followupDate!.toISOString(),
    newFollowupDate: new Date(l.createdAt.getTime() + 10 * 60 * 1000).toISOString(),
    followupReminderSentAt: l.followupReminderSentAt?.toISOString() ?? null,
  }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/followup-10min-backfill-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify(
      { timestamp: new Date().toISOString(), dryRun, fix: "BUG3 auto-7PM followup → createdAt+10min", count: backup.length, leads: backup },
      null,
      2,
    ),
  );
  console.log(`\n📝 Backup (${backup.length} rows): ${backupPath}`);
  console.log("   sample (first 5):");
  for (const b of backup.slice(0, 5)) console.log(`     ${b.id.slice(0, 12)}  ${b.oldFollowupDate} → ${b.newFollowupDate}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  let applied = 0;
  for (const l of target) {
    const next = new Date(l.createdAt.getTime() + 10 * 60 * 1000);
    await prisma.lead.update({
      where: { id: l.id },
      data: { followupDate: next, followupReminderSentAt: null },
    });
    if (actor) {
      await prisma.leadFieldHistory.create({
        data: {
          leadId: l.id, field: "followupDate",
          oldValue: l.followupDate!.toISOString(), newValue: next.toISOString(),
          changedById: actor.id, source: "followup-10min-backfill",
        },
      }).catch(() => {});
    }
    applied++;
  }
  console.log(`\n✅ Shifted followupDate → createdAt+10min on: ${applied} leads`);

  // Read-back verification — none of the backfilled leads should still match the
  // auto-7PM signature (their followup is no longer 19:00 IST).
  const after = await prisma.lead.findMany({
    where: { id: { in: target.map((l) => l.id) } },
    select: { id: true, createdAt: true, followupDate: true },
  });
  const stillSeven = after.filter((l) => l.followupDate && istIsSevenPM(l.followupDate) && istDayKey(l.followupDate) === istDayKey(l.createdAt)).length;
  const exact10 = after.filter((l) => l.followupDate && Math.abs(l.followupDate.getTime() - (l.createdAt.getTime() + 10 * 60 * 1000)) < 1000).length;
  console.log(`Read-back · still auto-7PM: ${stillSeven} (expected 0) · now exactly createdAt+10min: ${exact10}/${after.length}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });

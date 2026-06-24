/**
 * scripts/backfill-terminal-followup.ts
 *
 * FIX 2 (data-integrity batch 2026-06-25): clear followupDate on leads that are
 * already in a TERMINAL status (booked/sold/leased OR lost/rejected) but still
 * carry an active followupDate.
 *
 * WHY: the Action-List follow-up board intentionally applies NO status filter
 * (requirement: "show all follow-ups, no status exclusion"). So a terminal lead
 * that still has a followupDate shows up under "Overdue" as if it were
 * actionable — inflating Action-List-Overdue (189) above the Leads Overdue chip
 * (90, which excludes terminal via workableWhere). The correct fix is at the
 * SOURCE: a terminal lead should not have an active followupDate. Going forward
 * the reject flow + the /update status-change path clear it; this backfills the
 * existing ~99 live terminal leads so the two counts reconcile.
 *
 * SAFE + IDEMPOTENT:
 *   • Only leads with deletedAt:null, currentStatus ∈ TERMINAL_STATUSES, AND
 *     followupDate != null — re-running is a no-op.
 *   • Backs up every affected lead (id, name, status, prior followupDate +
 *     followupReminderSentAt) to backups/ BEFORE writing.
 *   • Writes a LeadFieldHistory audit row per lead (field "followupDate",
 *     old→null, source "terminal-followup-backfill").
 *   • Clears followupReminderSentAt too (the 10-min reminder dedupe) so no stale
 *     reminder fires. (Not audited — it's an internal dedupe flag, not user data.)
 *   • Reads back a verification count after applying.
 *   • NEVER touches remarks / conversation history / the status itself.
 *
 * Usage:
 *   npx tsx scripts/backfill-terminal-followup.ts --dry-run   # report only
 *   npx tsx scripts/backfill-terminal-followup.ts             # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`🧹 Terminal-lead followupDate clear${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(64));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
    select: { id: true, name: true, currentStatus: true, followupDate: true, followupReminderSentAt: true },
  });
  console.log(`Live terminal leads with a followupDate: ${leads.length}`);

  const byStatus = new Map<string, number>();
  for (const l of leads) byStatus.set(l.currentStatus ?? "(null)", (byStatus.get(l.currentStatus ?? "(null)") ?? 0) + 1);
  for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s.padEnd(28)} ${n}`);

  const backup = leads.map((l) => ({
    id: l.id, name: l.name, currentStatus: l.currentStatus,
    followupDate: l.followupDate?.toISOString() ?? null,
    followupReminderSentAt: l.followupReminderSentAt?.toISOString() ?? null,
  }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/terminal-followup-backfill-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, fix: "FIX2 clear followupDate on terminal leads", count: backup.length, leads: backup }, null, 2));
  console.log(`\n📝 Backup (${backup.length} rows): ${backupPath}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  let applied = 0;
  for (const l of leads) {
    await prisma.lead.update({
      where: { id: l.id },
      data: { followupDate: null, followupReminderSentAt: null },
    });
    // Audit the followupDate change old→null (LeadFieldHistory) — the reminder
    // flag is an internal dedupe, not audited.
    if (actor) {
      await prisma.leadFieldHistory.create({
        data: {
          leadId: l.id, field: "followupDate",
          oldValue: l.followupDate?.toISOString() ?? null, newValue: null,
          changedById: actor.id, source: "terminal-followup-backfill",
        },
      }).catch(() => {});
    }
    applied++;
  }
  console.log(`\n✅ Cleared followupDate on: ${applied} terminal leads`);

  // Read-back verification.
  const remaining = await prisma.lead.count({
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
  });
  console.log(`Read-back · terminal leads STILL carrying a followupDate: ${remaining} (expected 0)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });

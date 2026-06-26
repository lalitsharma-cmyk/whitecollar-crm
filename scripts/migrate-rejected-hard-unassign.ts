/**
 * One-time migration — apply the reject HARD-UNASSIGN retroactively.
 *
 * Lalit's final rule (2026-06-27): a rejected lead must be UNASSIGNED, with the
 * owner-at-rejection preserved as `previousOwnerId` (shown as "Previous Owner"),
 * the follow-up cleared, and removed from active workload/reports.
 *
 * Pre-this-change, rejected leads kept their `ownerId`. This script brings every
 * EXISTING rejected lead (rejectedAt != null, ownerId != null) into the new shape:
 *   previousOwnerId = COALESCE(previousOwnerId, ownerId)   ← preserve, don't clobber
 *   ownerId        = NULL
 *   assignedAt     = NULL
 *   followupDate   = NULL
 *
 * Safety:
 *   • BACKUP-FIRST — writes a JSON snapshot of every row it will touch.
 *   • IDEMPOTENT — re-running is a no-op (already-unassigned rows have ownerId NULL).
 *   • Per-query (NO interactive transaction) so a Neon connection blip can't strand
 *     a half-open tx; the single UPDATE is itself atomic.
 *   • Reporting is already robust to BOTH shapes (agentPerformance attributes via
 *     ownerId-if-set-else-previousOwnerId), so there is no read-time window of wrong
 *     counts before/after this runs.
 */
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // 1. Snapshot every row we will touch (rejected + still-owned).
  const toTouch = await prisma.lead.findMany({
    where: { rejectedAt: { not: null }, ownerId: { not: null } },
    select: {
      id: true,
      name: true,
      ownerId: true,
      previousOwnerId: true,
      assignedAt: true,
      followupDate: true,
      currentStatus: true,
      rejectedAt: true,
    },
  });

  console.log(`Rejected leads still carrying an ownerId: ${toTouch.length}`);
  if (toTouch.length === 0) {
    console.log("Nothing to migrate — every rejected lead is already unassigned. ✓");
    return;
  }

  const backupDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  // No Date.now() in this runtime context normally, but this is a plain Node script.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `rejected-hard-unassign-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toTouch, null, 2), "utf8");
  console.log(`📦 Backup written: ${backupPath}`);

  // Sample for the log.
  for (const l of toTouch.slice(0, 8)) {
    console.log(`   • ${l.id}  ${l.name ?? "(no name)"}  owner=${l.ownerId}  prevOwner=${l.previousOwnerId ?? "—"}  status=${l.currentStatus ?? "—"}`);
  }
  if (toTouch.length > 8) console.log(`   …and ${toTouch.length - 8} more`);

  if (dryRun) {
    console.log("\n--dry-run — no writes performed.");
    return;
  }

  // 2. Single atomic column-copy UPDATE. COALESCE preserves any previousOwnerId
  //    that already exists (never overwrite a real previous owner with a null).
  const affected = await prisma.$executeRawUnsafe(
    `UPDATE "Lead"
       SET "previousOwnerId" = COALESCE("previousOwnerId", "ownerId"),
           "ownerId"         = NULL,
           "assignedAt"      = NULL,
           "followupDate"    = NULL
     WHERE "rejectedAt" IS NOT NULL AND "ownerId" IS NOT NULL`,
  );
  console.log(`\n✏️  Rows updated: ${affected}`);

  // 3. Verify the post-state.
  const stillOwned = await prisma.lead.count({ where: { rejectedAt: { not: null }, ownerId: { not: null } } });
  const nowPrev = await prisma.lead.count({ where: { rejectedAt: { not: null }, previousOwnerId: { not: null } } });
  const stillFu = await prisma.lead.count({ where: { rejectedAt: { not: null }, followupDate: { not: null } } });
  console.log(`\nVERIFY:`);
  console.log(`   rejected leads still carrying ownerId : ${stillOwned}  (expect 0)`);
  console.log(`   rejected leads with previousOwnerId   : ${nowPrev}`);
  console.log(`   rejected leads still carrying followup: ${stillFu}  (expect 0)`);

  if (stillOwned === 0 && stillFu === 0) {
    console.log(`\n✅ Migration complete — all rejected leads are unassigned, follow-ups cleared, previous owner preserved.`);
  } else {
    console.log(`\n⚠️  Unexpected residue — investigate before considering this done.`);
  }
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

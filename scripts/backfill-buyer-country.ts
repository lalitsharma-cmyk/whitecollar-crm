/**
 * One-time backfill — populate the empty BuyerRecord.country (#247).
 *
 * Buyer Data is a DUBAI-only module (every record is market="Dubai"), and the
 * detail Location card's "Country" is the PROPERTY country. So every Dubai-market
 * record with a blank country gets "United Arab Emirates". Admins can still change
 * any individual record via the new country dropdown.
 *
 * Safety: BACKUP-FIRST (JSON snapshot of every touched row), single atomic UPDATE,
 * idempotent (re-running is a no-op once countries are set), verification at the end.
 */
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const UAE = "United Arab Emirates";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const toTouch = await prisma.buyerRecord.findMany({
    where: { market: "Dubai", OR: [{ country: null }, { country: "" }] },
    select: { id: true, clientName: true, market: true, nationality: true, projectName: true, country: true, deletedAt: true },
  });
  console.log(`Dubai-market buyers with empty country: ${toTouch.length}`);
  if (toTouch.length === 0) {
    console.log("Nothing to backfill — every Dubai buyer already has a country. ✓");
    return;
  }

  const backupDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `buyer-country-backfill-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(toTouch, null, 2), "utf8");
  console.log(`📦 Backup written: ${backupPath}`);

  if (dryRun) { console.log("\n--dry-run — no writes performed."); return; }

  const affected = await prisma.buyerRecord.updateMany({
    where: { market: "Dubai", OR: [{ country: null }, { country: "" }] },
    data: { country: UAE },
  });
  console.log(`\n✏️  Rows updated: ${affected.count} → country="${UAE}"`);

  const stillEmpty = await prisma.buyerRecord.count({ where: { market: "Dubai", OR: [{ country: null }, { country: "" }] } });
  const nowUae = await prisma.buyerRecord.count({ where: { market: "Dubai", country: UAE } });
  console.log(`\nVERIFY:`);
  console.log(`   Dubai buyers still empty country : ${stillEmpty}  (expect 0)`);
  console.log(`   Dubai buyers country="${UAE}" : ${nowUae}`);
  console.log(stillEmpty === 0 ? `\n✅ Backfill complete.` : `\n⚠️  Some rows still empty — investigate.`);
}

main().catch((e) => { console.error("Backfill failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());

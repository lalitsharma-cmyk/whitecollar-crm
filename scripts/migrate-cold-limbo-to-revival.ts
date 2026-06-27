/**
 * Urgent reconciliation — leads flagged isColdCall=true but left with a non-cold
 * leadOrigin (MASTER_DATA / ACTIVE_LEAD) are INVISIBLE in both modules: the Revival
 * list filters by leadOrigin ∈ COLD_ORIGINS (so they don't show there), and Master
 * Data excludes isColdCall=true (so they don't show there either). A revival import
 * created this limbo (it set isColdCall but not leadOrigin=REVIVAL on matched leads).
 *
 * Fix: move every such lead to leadOrigin="REVIVAL" so it appears in the Revival
 * Engine where it belongs. Backup-first, idempotent, NEVER touches anything else.
 *
 *   npx tsx scripts/migrate-cold-limbo-to-revival.ts            # dry-run
 *   npx tsx scripts/migrate-cold-limbo-to-revival.ts --apply
 */
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const APPLY = process.argv.includes("--apply");
const COLD = ["COLD", "REVIVAL"];

async function main() {
  const limbo = await prisma.lead.findMany({
    where: { isColdCall: true, deletedAt: null, leadOrigin: { notIn: COLD as never } },
    select: { id: true, name: true, leadOrigin: true, importBatchId: true, createdAt: true },
  });
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — cold limbo leads (isColdCall=true, origin NOT COLD/REVIVAL): ${limbo.length}`);
  for (const l of limbo) console.log(`  ${l.id} ${(l.name ?? "").slice(0, 24)} origin=${l.leadOrigin} batch=${l.importBatchId?.slice(0, 8) ?? "—"}`);
  if (limbo.length === 0) { console.log("Nothing to reconcile. ✓"); return; }
  if (!APPLY) { console.log("\n--dry-run — no writes."); return; }

  fs.mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const p = path.join(process.cwd(), "backups", `cold-limbo-to-revival-${stamp}.json`);
  fs.writeFileSync(p, JSON.stringify(limbo, null, 2), "utf8");
  console.log(`\n📦 Backup: ${p}`);

  const r = await prisma.lead.updateMany({
    where: { isColdCall: true, deletedAt: null, leadOrigin: { notIn: COLD as never } },
    data: { leadOrigin: "REVIVAL" as never },
  });
  console.log(`✏️  Updated ${r.count} → leadOrigin=REVIVAL`);

  const remain = await prisma.lead.count({ where: { isColdCall: true, deletedAt: null, leadOrigin: { notIn: COLD as never } } });
  const revivalVisible = await prisma.lead.count({ where: { deletedAt: null, leadOrigin: "REVIVAL" as never } });
  console.log(`VERIFY limbo remaining: ${remain} (expect 0) · REVIVAL-origin total now: ${revivalVisible}`);
  console.log(remain === 0 ? "✅ Reconciled — all now visible in Revival." : "⚠️  residue.");
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());

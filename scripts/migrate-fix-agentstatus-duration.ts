/**
 * Corrective — recompute AgentStatusEvent.durationMin from its own start/end
 * timestamps wherever the stored value drifted (durationMin is a DERIVED field;
 * the timestamps are the source of truth). Backup-first, idempotent.
 *
 *   npx tsx scripts/migrate-fix-agentstatus-duration.ts            # dry-run
 *   npx tsx scripts/migrate-fix-agentstatus-duration.ts --apply
 */
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";

const APPLY = process.argv.includes("--apply");

async function main() {
  const closed = await prisma.agentStatusEvent.findMany({
    where: { durationMin: { not: null }, endedAt: { not: null } },
    select: { id: true, startedAt: true, endedAt: true, durationMin: true },
  });
  const drift = closed.filter((r) => {
    const expected = Math.max(0, Math.round((r.endedAt!.getTime() - r.startedAt!.getTime()) / 60_000));
    return r.durationMin !== expected;
  }).map((r) => ({ ...r, expected: Math.max(0, Math.round((r.endedAt!.getTime() - r.startedAt!.getTime()) / 60_000)) }));

  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} — ${closed.length} closed rows · ${drift.length} drifted`);
  for (const r of drift) console.log(`  ${r.id} durationMin ${r.durationMin} → ${r.expected}`);
  if (drift.length === 0) { console.log("Nothing to fix. ✓"); return; }
  if (!APPLY) { console.log("\n--dry-run — no writes."); return; }

  fs.mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const p = path.join(process.cwd(), "backups", `agentstatus-duration-${stamp}.json`);
  fs.writeFileSync(p, JSON.stringify(drift, null, 2), "utf8");
  console.log(`\n📦 Backup: ${p}`);

  for (const r of drift) {
    await prisma.agentStatusEvent.update({ where: { id: r.id }, data: { durationMin: r.expected } });
  }
  console.log(`✏️  Recomputed ${drift.length} row(s).`);
  const remain = (await prisma.agentStatusEvent.findMany({
    where: { durationMin: { not: null }, endedAt: { not: null } },
    select: { id: true, startedAt: true, endedAt: true, durationMin: true },
  })).filter((r) => r.durationMin !== Math.max(0, Math.round((r.endedAt!.getTime() - r.startedAt!.getTime()) / 60_000))).length;
  console.log(`VERIFY remaining drift: ${remain} (expect 0)`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());

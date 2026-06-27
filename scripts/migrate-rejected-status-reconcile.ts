/**
 * One-time reconciliation — a REJECTED lead must carry a TERMINAL (rejection) status.
 *
 * Some rejected leads (rejectedAt + rejectionReason set) still carry a stale WORKABLE
 * currentStatus ("Fresh Lead", "Follow Up", "Other", …) — left over from an old reject
 * flow or a later status edit. That makes them leak into status-based active/workable
 * surfaces (and miss the Lost/Rejected bucket). rejectedAt is the source of truth, so
 * this sets currentStatus = rejectionStatusFor(rejectionReason) (all reasons now map to
 * a terminal status, incl OTHER→"Other" which is now in LOST_STATUSES). A null/unknown
 * reason falls back to "Other".
 *
 * Safety: BACKUP-FIRST, idempotent (re-run = 0), per-row update (Neon-resilient),
 * NEVER touches anything but currentStatus on already-rejected leads.
 *
 *   npx tsx scripts/migrate-rejected-status-reconcile.ts            # dry-run
 *   npx tsx scripts/migrate-rejected-status-reconcile.ts --apply
 */
import { prisma } from "../src/lib/prisma";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";
import { rejectionStatusFor } from "../src/lib/reject-reasons";
import * as fs from "fs";
import * as path from "path";

const APPLY = process.argv.includes("--apply");
const term = new Set<string>([...TERMINAL_STATUSES]);

function terminalStatusForReason(reason: string | null): string {
  if (reason) {
    const s = rejectionStatusFor(reason);
    if (s && term.has(s)) return s;
  }
  return "Other"; // generic terminal rejection outcome (now in LOST_STATUSES)
}

async function main() {
  // Rejected leads whose currentStatus is NOT terminal (incl null/blank).
  const all = await prisma.lead.findMany({
    where: {
      rejectedAt: { not: null },
      OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: [...TERMINAL_STATUSES] } }],
    },
    select: { id: true, name: true, currentStatus: true, rejectionReason: true },
  });
  console.log(`Rejected leads with a non-terminal status: ${all.length}`);
  if (all.length === 0) { console.log("Nothing to reconcile — every rejected lead is already terminal. ✓"); return; }

  const plan = all.map((l) => ({ id: l.id, name: l.name, from: l.currentStatus, to: terminalStatusForReason(l.rejectionReason), reason: l.rejectionReason }));
  for (const p of plan.slice(0, 12)) console.log(`  • ${p.id} ${p.name ?? ""}: ${JSON.stringify(p.from)} → "${p.to}" (reason=${p.reason ?? "—"})`);
  if (plan.length > 12) console.log(`  …and ${plan.length - 12} more`);

  if (!APPLY) { console.log("\n--dry-run — no writes."); return; }

  fs.mkdirSync(path.join(process.cwd(), "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(process.cwd(), "backups", `rejected-status-reconcile-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(plan, null, 2), "utf8");
  console.log(`\n📦 Backup: ${backupPath}`);

  let n = 0;
  for (const p of plan) { await prisma.lead.update({ where: { id: p.id }, data: { currentStatus: p.to } }); n++; }
  console.log(`✏️  Updated ${n} leads.`);

  const remain = await prisma.lead.count({
    where: { rejectedAt: { not: null }, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: [...TERMINAL_STATUSES] } }] },
  });
  console.log(`VERIFY rejected+non-terminal remaining: ${remain} (expect 0)`);
  console.log(remain === 0 ? "✅ Reconciled." : "⚠️  residue — investigate.");
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());

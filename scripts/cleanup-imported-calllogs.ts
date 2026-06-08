// One-off cleanup for the Conversation History import fix (2026-06).
//
// Past Excel/CSV imports manufactured a synthetic CallLog per dated remark line
// (CallLog.attributedAgentName set). Those fake "calls" invented agent names and
// outcomes that polluted call statistics and showed remark words as the caller.
// The code fix (a) stops imports creating them and (b) renders the raw remark
// text — preserved on Lead.remarks — as read-only Historical Notes. This script
// removes the existing synthetic rows.
//
// SAFETY
//   • Default = DRY RUN: counts + writes a JSON backup, deletes NOTHING.
//   • Pass --confirm to actually delete.
//   • Predicate: attributedAgentName IS NOT NULL. Real calls (Log-Call UI /
//     Acefone webhook) never set it, so genuine calls are never touched.
//   • Content safety: the remark TEXT lives on Lead.remarks (untouched). These
//     CallLog rows carry nothing that isn't already on the lead, so removing
//     them loses no information. The JSON backup is belt-and-suspenders.
//
// Run:  npx tsx scripts/cleanup-imported-calllogs.ts            (dry run + backup)
//       npx tsx scripts/cleanup-imported-calllogs.ts --confirm  (perform delete)

import { prisma } from "../src/lib/prisma";
import { writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIRM = process.argv.includes("--confirm");
const WHERE = { attributedAgentName: { not: null } } as const;

async function main() {
  const total = await prisma.callLog.count();
  const imported = await prisma.callLog.count({ where: WHERE });
  const real = total - imported;

  console.log("CallLog rows:");
  console.log(`  total                 : ${total}`);
  console.log(`  imported (DELETE)     : ${imported}   (attributedAgentName set)`);
  console.log(`  real     (KEEP)       : ${real}`);

  if (imported === 0) {
    console.log("\nNothing to clean up.");
    return;
  }

  // Full backup of every row we may delete — written OUTSIDE the repo so the
  // client notes inside are never committed to git.
  const rows = await prisma.callLog.findMany({ where: WHERE });
  const backupFile = join(homedir(), "wcr-imported-calllogs-backup.json");
  writeFileSync(backupFile, JSON.stringify(rows, null, 2));
  console.log(`\nBacked up ${rows.length} rows → ${backupFile}`);

  // Distinct attributed "callers" — these are the fake names this cleanup removes.
  const names = new Map<string, number>();
  for (const r of rows) {
    const k = r.attributedAgentName ?? "?";
    names.set(k, (names.get(k) ?? 0) + 1);
  }
  const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`\nDistinct fake "callers": ${names.size}. Top 15 by row count:`);
  for (const [n, c] of top) console.log(`   ${String(c).padStart(5)}  ${n}`);

  // How many leads are affected.
  const leadIds = new Set(rows.map((r) => r.leadId).filter(Boolean));
  console.log(`\nAffected leads: ${leadIds.size}`);

  if (!CONFIRM) {
    console.log("\n🔸 DRY RUN — deleted nothing. Re-run with --confirm to delete.");
    return;
  }

  const res = await prisma.callLog.deleteMany({ where: WHERE });
  const after = await prisma.callLog.count();
  console.log(`\n✅ Deleted ${res.count} imported CallLog rows. Remaining: ${after} (expected ${real}).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

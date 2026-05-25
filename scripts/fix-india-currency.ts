// One-off: legacy India-team leads that were created with AED currency
// (before the team-currency lock landed). This script switches them to INR.
//
// Run:   npx tsx scripts/fix-india-currency.ts          (dry-run)
//        npx tsx scripts/fix-india-currency.ts --apply  (write changes)

import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");

async function main() {
  const p = new PrismaClient();
  const bad = await p.lead.findMany({
    where: { forwardedTeam: "India", budgetCurrency: "AED" },
    select: { id: true, name: true, budgetMin: true, budgetMax: true },
  });
  console.log(`Found ${bad.length} India-team leads with AED currency`);
  for (const l of bad) {
    console.log(`  ${l.name.padEnd(30)} budget: ${l.budgetMin ?? "—"}-${l.budgetMax ?? "—"} (will switch AED → INR)`);
  }
  if (bad.length === 0) {
    console.log("\nNothing to fix.");
    await p.$disconnect();
    return;
  }
  if (!apply) {
    console.log(`\nDry-run. Re-run with --apply to write.`);
    await p.$disconnect();
    return;
  }
  const r = await p.lead.updateMany({
    where: { forwardedTeam: "India", budgetCurrency: "AED" },
    data: { budgetCurrency: "INR" },
  });
  console.log(`\n✅ Updated ${r.count} rows from AED → INR.`);
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

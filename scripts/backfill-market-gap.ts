// Idempotent, derived, reversible BACKFILL for the lead-market-segregation gap.
// Mirrors runDataQualityScan()'s self-heal (dataQuality.ts:27-41): for every live
// lead that has a TEAM but no market, set the derived India/UAE market via the
// single-source resolveMarket(). Safe: only fills market when it can be DERIVED
// (team/currency); never overwrites a set market; never touches any other field.
// Re-running is a no-op once the gap is 0. Prints a before/after audit line per row.
import { prisma } from "../src/lib/prisma";
import { resolveMarket } from "../src/lib/market";

async function main() {
  const rows = await prisma.lead.findMany({
    where: { deletedAt: null, market: null, forwardedTeam: { not: null } },
    select: { id: true, name: true, forwardedTeam: true, budgetCurrency: true },
  });
  console.log(`Found ${rows.length} team-without-market row(s) to backfill.`);
  let fixed = 0, skipped = 0;
  for (const r of rows) {
    const m = resolveMarket(r);
    if (!m) { skipped++; console.log(`SKIP  ${r.id} (${r.name}) team=${r.forwardedTeam} ccy=${r.budgetCurrency} → unclassifiable, left null`); continue; }
    await prisma.lead.update({ where: { id: r.id }, data: { market: m } });
    fixed++;
    console.log(`FIXED ${r.id} (${r.name}) team=${r.forwardedTeam} ccy=${r.budgetCurrency} → market=${m}`);
  }
  const remaining = await prisma.lead.count({ where: { deletedAt: null, market: null, forwardedTeam: { not: null } } });
  console.log(`Backfill complete — fixed=${fixed} skipped=${skipped}; remaining gap=${remaining}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

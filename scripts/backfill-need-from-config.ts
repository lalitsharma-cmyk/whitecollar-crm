// Backfill BANT Need (needSummary) from Configuration for ALL existing leads
// where needSummary is blank/empty and configuration is set.
//
// Why: the lead page already DISPLAYS the configuration-derived Need live, but
// the BANT stage-gate, reports, filters and exports read the STORED needSummary
// column. This backfill makes the derived value real in the DB so those code
// paths also see it. Applies to every lead — active, rejected/lost, revival,
// soft-deleted — per Lalit's "fix existing data too" requirement.
//
// SAFE + ADDITIVE: never overwrites a needSummary that already has a value;
// only fills blanks. Mirrors the exact same formatting the UI uses
// (configuration.replace(/^(\d+)\s*(BHK|BR|RK)$/i, "$1 $2")).
//
// Usage:
//   npx tsx scripts/backfill-need-from-config.ts          (DRY RUN — counts only)
//   npx tsx scripts/backfill-need-from-config.ts --apply  (writes changes)

import { prisma } from "../src/lib/prisma";

function configToNeed(config: string): string {
  return config.trim().replace(/^(\d+)\s*(BHK|BR|RK)$/i, "$1 $2");
}

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates = await prisma.lead.findMany({
    where: {
      configuration: { not: null },
      OR: [{ needSummary: null }, { needSummary: "" }],
    },
    select: { id: true, name: true, configuration: true, needSummary: true, currentStatus: true, deletedAt: true },
  });

  // Guard against whitespace-only config / need that the SQL filter can't catch.
  const rows = candidates.filter(
    c => c.configuration && c.configuration.trim() && !(c.needSummary && c.needSummary.trim()),
  );

  console.log(`\nLeads with Configuration set but BANT Need blank: ${rows.length}`);

  const byConfig: Record<string, number> = {};
  for (const r of rows) {
    const k = `${r.configuration!.trim()} → ${configToNeed(r.configuration!.trim())}`;
    byConfig[k] = (byConfig[k] ?? 0) + 1;
  }
  console.log("\nBreakdown (stored config → Need to write):");
  for (const [k, n] of Object.entries(byConfig).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(5)}  ${k}`);
  }

  const deletedCount = rows.filter(r => r.deletedAt != null).length;
  console.log(`\n(of those, ${deletedCount} are soft-deleted leads — included per "fix existing data too")`);

  if (!apply) {
    console.log("\n── DRY RUN ── no changes written. Re-run with --apply to backfill.\n");
    return;
  }

  let n = 0;
  for (const r of rows) {
    await prisma.lead.update({
      where: { id: r.id },
      data: { needSummary: configToNeed(r.configuration!.trim()) },
    });
    n++;
    if (n % 200 === 0) console.log(`  …${n}/${rows.length}`);
  }
  console.log(`\n✅ Backfilled needSummary on ${n} leads from their Configuration.\n`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });

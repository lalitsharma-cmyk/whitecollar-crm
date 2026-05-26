// Clean up CallLog.attributedAgentName values that are truncated single-word
// last names (e.g. "Sharma") when the same data also contains the full name
// ("Lalit Sharma"). Caused by the old remarkParser regex that captured only
// the LAST CamelCase word from "Lalit Sharma:" prefixes; fixed in commit
// d52d5af but the historical data was already populated wrong.
//
// SAFE strategy: only merge a short name into a long name when:
//   1. The short name (e.g. "Sharma") appears as the SUFFIX of exactly ONE
//      long name (e.g. "Lalit Sharma") in the same dataset.
//   2. That long name has more occurrences (sanity — the canonical version
//      should dominate).
//   3. The notes prefix on the short-name rows starts with the short name
//      itself (so we know it's a parser-truncation, not someone else literally
//      written as "Sharma" in the sheet).
//
// If a short name is ambiguous (e.g. "Sharma" suffix of both "Lalit Sharma"
// AND "Rohit Sharma"), it's left alone — too risky to guess.
//
// Run:
//   npx tsx scripts/merge-truncated-attribution.ts            (dry run)
//   npx tsx scripts/merge-truncated-attribution.ts --apply    (commit)

import { prisma } from "../src/lib/prisma";

const FLAG_KEY = "backfill.mergeTruncatedAttribution.v1";

// ── Hand-curated mapping (Lalit confirmed the active team list 2026-05-26) ──
// Format: truncated value (as currently in DB) → canonical full name to set.
// Only names that unambiguously match exactly ONE active team member are here;
// ex-employees / external names (Nitisha, Kiran, Javed, Muskan, Dipti, Devansh,
// Sandeep, Neeraj, Unknown) are deliberately left alone — we don't have a
// reliable mapping for those and bad data is worse than legacy data.
const MANUAL_MAP: Record<string, string> = {
  "Sharma": "Lalit Sharma",      // only Sharma on team
  "Mehak": "Mehak Mukhija",      // only Mehak on team
  "Dinesh": "Dinesh Gill",       // only Dinesh on team
  "Nitsha": "Nitisha",           // typo of existing "Nitisha" (already 730 rows)
};

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  if (!force && apply) {
    const flag = await prisma.setting.findUnique({ where: { key: FLAG_KEY } }).catch(() => null);
    if (flag) {
      console.error(`❌ Already run on ${flag.value}. Pass --force to re-run.`);
      process.exit(1);
    }
  }

  // Get all distinct attributedAgentName values + their counts.
  const rows = await prisma.callLog.groupBy({
    by: ["attributedAgentName"],
    where: { attributedAgentName: { not: null } },
    _count: { _all: true },
  });

  type NameStat = { name: string; count: number };
  const stats: NameStat[] = rows
    .map((r) => ({ name: (r.attributedAgentName ?? "").trim(), count: r._count._all }))
    .filter((s) => s.name.length > 0)
    .sort((a, b) => b.count - a.count);

  console.log(`Distinct attribution names: ${stats.length}`);
  for (const s of stats) console.log(`  ${s.count.toString().padStart(5)} ${s.name}`);

  // Build the merge list from the hand-curated mapping. Skip entries that
  // don't actually exist in the data (defensive — if the dataset changes the
  // script becomes a no-op for that row rather than crashing).
  type Merge = { from: string; to: string; fromCount: number };
  const merges: Merge[] = [];
  for (const [from, to] of Object.entries(MANUAL_MAP)) {
    const s = stats.find((x) => x.name === from);
    if (!s) continue;
    merges.push({ from, to, fromCount: s.count });
  }

  console.log(`\nProposed merges (${merges.length}):`);
  for (const m of merges) {
    const already = stats.find((x) => x.name === m.to)?.count ?? 0;
    console.log(`  ${m.from.padEnd(15)} (${m.fromCount} rows)  →  ${m.to.padEnd(20)} (${already} rows already)`);
  }

  if (merges.length === 0) {
    console.log("\nNothing to merge.");
    return;
  }

  // Safety guard: verify the rows actually have notes starting with the short
  // name (so we know they're from the parser truncation, not someone literally
  // named that). If <80% match, refuse to merge that name.
  console.log(`\nSanity check — notes-prefix match rate:`);
  const realMerges: Merge[] = [];
  for (const m of merges) {
    const total = await prisma.callLog.count({ where: { attributedAgentName: m.from } });
    const matched = await prisma.callLog.count({
      where: { attributedAgentName: m.from, notes: { startsWith: `${m.from}:` } },
    });
    const pct = total > 0 ? Math.round((matched / total) * 100) : 0;
    const verdict = pct >= 80 ? "✓ will merge" : "⚠ DISQUALIFIED";
    console.log(`  ${m.from.padEnd(15)} ${matched}/${total} (${pct}%)  ${verdict}`);
    if (pct >= 80) realMerges.push(m);
  }

  console.log(`\nFinal merges to apply: ${realMerges.length}`);
  if (!apply) {
    console.log("\nDry run. Pass --apply to commit.");
    return;
  }

  let updated = 0;
  for (const m of realMerges) {
    const r = await prisma.callLog.updateMany({
      where: { attributedAgentName: m.from },
      data: { attributedAgentName: m.to },
    });
    console.log(`  ✓ ${m.from} → ${m.to}: ${r.count} rows updated`);
    updated += r.count;
  }

  await prisma.setting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  console.log(`\n✅ Done — merged ${updated} CallLog rows. Flag: "${FLAG_KEY}".`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

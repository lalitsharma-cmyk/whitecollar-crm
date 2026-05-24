// One-off: walk every lead, normalize its phone to E.164 based on team/country hint.
//
// Without this, leads imported before the country-code picker landed will still
// have wa.me / tel: links that don't work on mobile (e.g. "8826858649" with no
// country code → wa.me/8826858649 → invalid).
//
// Run:   npx tsx scripts/backfill-phones.ts          (dry-run)
//        npx tsx scripts/backfill-phones.ts --apply  (write changes)

import { PrismaClient } from "@prisma/client";
import { toE164 } from "../src/lib/phone";

const apply = process.argv.includes("--apply");

async function main() {
  const prisma = new PrismaClient();
  const leads = await prisma.lead.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, phone: true, country: true, forwardedTeam: true },
  });

  let changed = 0, already = 0, ambiguous = 0;
  const updates: Array<{ id: string; old: string; next: string }> = [];

  for (const l of leads) {
    const p = l.phone ?? "";
    if (!p) continue;
    if (p.startsWith("+")) { already++; continue; }
    const digits = p.replace(/\D/g, "");
    // Phone-format heuristic FIRST — it's more reliable than forwardedTeam (which
    // we sometimes set to Dubai as a default). Indian mobiles are 10 digits starting
    // 6-9; UAE mobiles are 9 digits starting 5.
    const looksIndian = /^[6-9]\d{9}$/.test(digits);
    const looksUae    = /^5[02458]\d{7}$/.test(digits);
    const hint =
      looksIndian ? "+91" :
      looksUae    ? "+971" :
      l.country === "India" ? "+91" :
      l.country === "UAE" || l.country === "United Arab Emirates" ? "+971" :
      l.forwardedTeam === "India" ? "+91" :
      l.forwardedTeam === "Dubai" ? "+971" :
      null;
    if (!hint) {
      ambiguous++;
      console.log(`?  ${l.name.padEnd(30)} | ${p.padEnd(20)} | no team/country hint, skipping`);
      continue;
    }
    const next = toE164(p, hint);
    if (!next || next === p) { already++; continue; }
    updates.push({ id: l.id, old: p, next });
    console.log(`→  ${l.name.padEnd(30)} | ${p.padEnd(20)} → ${next}`);
    changed++;
  }

  console.log(`\nSummary: ${leads.length} leads scanned`);
  console.log(`  changed:   ${changed}`);
  console.log(`  unchanged: ${already}`);
  console.log(`  ambiguous: ${ambiguous}`);

  if (!apply) {
    console.log(`\nDry-run. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }

  for (const u of updates) {
    await prisma.lead.update({ where: { id: u.id }, data: { phone: u.next } });
  }
  console.log(`\n✅ Wrote ${updates.length} updates to the database.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

// One-off backfill: subtract 5h30m from every IMPORTED CallLog's startedAt.
//
// Why: until this commit, src/lib/remarkParser.ts treated the time written in
// MIS remarks ("on 3 May (12:36)") as Vercel-local (UTC) wall-clock and stored
// 12:36 UTC. Displayed via fmtIST() that becomes 18:06 IST — a 5h30m offset
// from what Lalit's team actually wrote in the sheet. The parser now converts
// (yr, mon, day, h, mins) as IST → UTC, but every CallLog imported before this
// fix is still wrong in the DB.
//
// "Imported" identifier: CallLog.attributedAgentName IS NOT NULL. That column
// is ONLY populated by the importer (manual call logs from the UI leave it
// null). So we can target the bad rows precisely without touching real calls.
//
// Run:  npx tsx scripts/backfill-imported-call-times.ts            (dry run)
//       npx tsx scripts/backfill-imported-call-times.ts --apply    (commit)
//
// Idempotency guard: the script writes a feature flag in Setting once it
// completes so a second run doesn't double-shift the rows. Pass --force to
// override (only useful for re-testing on a fresh DB clone).

import { prisma } from "../src/lib/prisma";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FLAG_KEY = "backfill.importedCallTimes.istShift.v1";

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  if (!force) {
    const flag = await prisma.setting.findUnique({ where: { key: FLAG_KEY } }).catch(() => null);
    if (flag) {
      console.error(`❌ Already run on ${flag.value}. Pass --force to re-run (DANGEROUS — would double-shift).`);
      process.exit(1);
    }
  }

  const rows = await prisma.callLog.findMany({
    where: { attributedAgentName: { not: null } },
    select: { id: true, startedAt: true, attributedAgentName: true, leadId: true },
    orderBy: { startedAt: "asc" },
  });

  console.log(`Found ${rows.length} imported CallLog rows.`);
  if (rows.length === 0) { console.log("Nothing to do."); return; }

  console.log("First 5 examples (before → after):");
  for (const r of rows.slice(0, 5)) {
    const after = new Date(r.startedAt.getTime() - IST_OFFSET_MS);
    console.log(`  ${r.id}  ${r.attributedAgentName}`);
    console.log(`    before: ${r.startedAt.toISOString()}  (displays as ${fmtIST(r.startedAt)} IST)`);
    console.log(`    after:  ${after.toISOString()}  (displays as ${fmtIST(after)} IST)`);
  }

  if (!apply) {
    console.log(`\nDry run. Pass --apply to commit ${rows.length} row updates.`);
    return;
  }

  let done = 0;
  const t0 = Date.now();
  for (const r of rows) {
    const newStarted = new Date(r.startedAt.getTime() - IST_OFFSET_MS);
    await prisma.callLog.update({ where: { id: r.id }, data: { startedAt: newStarted } });
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${rows.length} (${Math.round(done / rows.length * 100)}%)`);
  }

  await prisma.setting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n✅ Done — shifted ${done} CallLog rows by -5h30m (${sec}s). Flag written to Setting "${FLAG_KEY}".`);
}

function fmtIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

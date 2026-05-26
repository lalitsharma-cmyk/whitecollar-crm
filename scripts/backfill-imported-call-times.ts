// One-off backfill for IMPORTED CallLogs.
//
// Two corrections in one pass:
//
//   1) Time shift: every imported row's startedAt was stored from the MIS sheet
//      text ("on 3 May 2026 (12:36)") as if 12:36 was UTC, so it displays as
//      18:06 IST (+5h30). Subtract 5h30 so fmtIST() shows the same wall-clock
//      time the agent wrote.
//
//   2) Attribution: extract the agent name from the notes prefix ("Kiran: ...")
//      and persist it to attributedAgentName so the Call History card shows
//      "Kiran" instead of falling back to "Admin" (the importer).
//
// Target rows:
//   attributedAgentName IS NULL  (so post-fix imports aren't double-touched)
//   AND notes matches /^[A-Z][A-Za-z\s]{1,40}:\s/  ("Name: ...")
//
// Run:
//   npx tsx scripts/backfill-imported-call-times.ts            (dry run)
//   npx tsx scripts/backfill-imported-call-times.ts --apply    (commit)
//   --force                                                     (re-run even if flag exists)
//
// Idempotency: a Setting row records completion. Rerunning is a no-op unless
// --force is passed. Setting both attributedAgentName + the time means a
// re-run is also self-protected: the WHERE clause excludes rows that already
// have attributedAgentName.

import { prisma } from "../src/lib/prisma";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FLAG_KEY = "backfill.importedCallTimes.istShift.v2";

// Match the same agent-name pattern used by parseRemarks: 1-3 CamelCase words.
const NAME_PREFIX_RE = /^([A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2})\s*:\s*/;

async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  if (!force) {
    const flag = await prisma.setting.findUnique({ where: { key: FLAG_KEY } }).catch(() => null);
    if (flag) {
      console.error(`❌ Already run on ${flag.value}. Pass --force to re-run.`);
      process.exit(1);
    }
  }

  // Find rows where attribution is missing AND notes look like an imported entry.
  // Bring back ONLY the columns we need to minimise data transfer.
  const candidates = await prisma.callLog.findMany({
    where: {
      attributedAgentName: null,
      notes: { not: null },
    },
    select: { id: true, startedAt: true, notes: true },
    orderBy: { startedAt: "asc" },
  });

  // Filter in JS for the regex match (Prisma doesn't have a regex contains
  // operator portable across Postgres + SQLite test DB).
  const targets = candidates
    .map((c) => {
      const m = (c.notes ?? "").match(NAME_PREFIX_RE);
      if (!m) return null;
      return { id: c.id, startedAt: c.startedAt, agentName: m[1].trim() };
    })
    .filter((x): x is { id: string; startedAt: Date; agentName: string } => x != null);

  console.log(`Candidates with null attribName: ${candidates.length}`);
  console.log(`Matching "Name: ..." pattern (will fix): ${targets.length}`);
  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\nFirst 5 examples (before → after):");
  for (const t of targets.slice(0, 5)) {
    const after = new Date(t.startedAt.getTime() - IST_OFFSET_MS);
    console.log(`  ${t.id.slice(0,8)}  ${t.agentName.padEnd(20)} ${t.startedAt.toISOString()} → ${after.toISOString()}`);
    console.log(`    displays: ${fmtIST(t.startedAt)} → ${fmtIST(after)} IST`);
  }

  if (!apply) {
    console.log(`\nDry run. Pass --apply to commit ${targets.length} row updates.`);
    return;
  }

  let done = 0;
  const t0 = Date.now();
  for (const t of targets) {
    const newStarted = new Date(t.startedAt.getTime() - IST_OFFSET_MS);
    await prisma.callLog.update({
      where: { id: t.id },
      data: {
        startedAt: newStarted,
        attributedAgentName: t.agentName,
      },
    });
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${targets.length} (${Math.round(done / targets.length * 100)}%)`);
  }

  await prisma.setting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n✅ Done — shifted ${done} CallLog rows by -5h30m + populated attributedAgentName (${sec}s). Flag: "${FLAG_KEY}".`);
}

function fmtIST(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

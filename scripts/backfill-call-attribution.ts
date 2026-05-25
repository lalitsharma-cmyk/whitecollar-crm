// Re-parse every CallLog.notes prefix to set attributedAgentName correctly.
// Captures FULL agent names ("Lalit Sharma", "Dr Gagan Jain") not just the
// last word — earlier parser was returning "Sharma" for "Lalit Sharma:".
//
// Safe to re-run. Doesn't touch user records, only CallLog.attributedAgentName.

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// Same shape as the live importer regex — capture 1-3 CamelCase words before ":"
const PREFIX_RE = /^([A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2})\s*:\s*/;

(async () => {
  const calls = await p.callLog.findMany({
    select: { id: true, notes: true, attributedAgentName: true },
  });
  console.log(`Scanning ${calls.length} call logs…`);

  let updated = 0;
  let cleared = 0;
  let unchanged = 0;
  const dist = new Map<string, number>();

  for (const c of calls) {
    if (!c.notes) continue;
    const m = c.notes.match(PREFIX_RE);
    const newName = m ? m[1].trim() : null;
    if (newName === c.attributedAgentName) { unchanged++; continue; }

    await p.callLog.update({
      where: { id: c.id },
      data: { attributedAgentName: newName },
    });
    if (newName) {
      updated++;
      dist.set(newName, (dist.get(newName) ?? 0) + 1);
    } else {
      cleared++;
    }
  }

  console.log(`\n  ✓ ${updated} updated  ·  ${cleared} cleared  ·  ${unchanged} unchanged`);
  console.log("\n  Top 20 attributed agents:");
  [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([n, count]) => {
    console.log(`    ${n.padEnd(22)} ${count}`);
  });

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

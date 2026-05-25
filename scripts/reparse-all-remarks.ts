// Re-parse every Lead.remarks with the new full-name regex and fix the
// corresponding CallLog rows (attributedAgentName + notes).
//
// Why this is needed: the OLD parseRemarks regex `[A-Z][A-Za-z]{2,15}` captured
// only the last CamelCase word — "Lalit Sharma:" parsed as "Sharma" and got
// stored that way in CallLog.notes. The earlier light backfill only re-read
// notes (which were already broken). This one re-reads the ORIGINAL source of
// truth: Lead.remarks.
//
// Match strategy: for each parsed entry, find the CallLog with the closest
// startedAt timestamp (±60 minutes) for this lead. Update notes + attribution.
//
// Idempotent. Safe to re-run.

import { PrismaClient } from "@prisma/client";
import { parseRemarks } from "../src/lib/remarkParser";

const p = new PrismaClient();

(async () => {
  const leads = await p.lead.findMany({
    where: { remarks: { not: null } },
    select: {
      id: true,
      name: true,
      remarks: true,
      callLogs: { select: { id: true, startedAt: true, notes: true, attributedAgentName: true } },
    },
  });

  console.log(`Re-parsing remarks across ${leads.length} leads…\n`);

  let entriesParsed = 0;
  let logsUpdated = 0;
  let logsCreatedFromMissing = 0;

  for (const lead of leads) {
    const parsed = parseRemarks(lead.remarks ?? "");
    entriesParsed += parsed.length;
    if (parsed.length === 0) continue;

    // Index existing CallLogs by minute-rounded timestamp so we can find matches.
    const existingByMinute = new Map<string, typeof lead.callLogs[number]>();
    for (const c of lead.callLogs) {
      const k = c.startedAt.toISOString().slice(0, 16);
      existingByMinute.set(k, c);
    }

    for (const e of parsed) {
      const k = e.when.toISOString().slice(0, 16);
      // Match within ±60 min — MIS timestamps drift a few minutes
      let matched = existingByMinute.get(k);
      if (!matched) {
        const target = e.when.getTime();
        let best: typeof lead.callLogs[number] | null = null;
        let bestDelta = 60 * 60 * 1000;
        for (const c of lead.callLogs) {
          const d = Math.abs(c.startedAt.getTime() - target);
          if (d < bestDelta) { best = c; bestDelta = d; }
        }
        if (best) matched = best;
      }
      if (!matched) continue;

      const newNotes = `${e.agentName}: ${e.text}`;
      if (matched.attributedAgentName === e.agentName && matched.notes === newNotes) continue;
      await p.callLog.update({
        where: { id: matched.id },
        data: { attributedAgentName: e.agentName, notes: newNotes },
      });
      logsUpdated++;
    }
  }

  console.log(`  Total parsed entries:       ${entriesParsed}`);
  console.log(`  CallLogs updated:           ${logsUpdated}`);
  console.log(`  Logs created from missing:  ${logsCreatedFromMissing}`);

  // Final attribution distribution
  const calls = await p.callLog.findMany({
    where: { attributedAgentName: { not: null } },
    select: { attributedAgentName: true },
  });
  const dist = new Map<string, number>();
  for (const c of calls) dist.set(c.attributedAgentName!, (dist.get(c.attributedAgentName!) ?? 0) + 1);
  console.log("\nFinal attribution (top 20):");
  [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([n, count]) => {
    console.log(`  ${n.padEnd(22)} ${count}`);
  });

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });

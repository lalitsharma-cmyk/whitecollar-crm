// Fix historical CallLog records where the outcome was incorrectly set to CONNECTED
// but the notes clearly indicate the call was not connected:
//   • "voicemail"       → NOT_PICKED
//   • "not reachable" / "unreachable" / "number not reachable" → SWITCHED_OFF
//
// Safe to re-run — it only touches records still sitting at CONNECTED with those keywords.
//
// Usage:
//   npx tsx scripts/fix-call-outcomes.ts
//   # or with dry-run to preview counts without writing:
//   DRY_RUN=1 npx tsx scripts/fix-call-outcomes.ts

import { PrismaClient, CallOutcome } from "@prisma/client";

const p = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1";

(async () => {
  console.log(DRY_RUN ? "── DRY RUN (no writes) ──" : "── LIVE RUN ──");

  // ── 1. Voicemail → NOT_PICKED ──────────────────────────────────────────────
  const voicemailWhere = {
    outcome: CallOutcome.CONNECTED,
    notes: { contains: "voicemail", mode: "insensitive" as const },
  };

  if (DRY_RUN) {
    const count = await p.callLog.count({ where: voicemailWhere });
    console.log(`[DRY] Would fix ${count} voicemail record(s) → NOT_PICKED`);
  } else {
    const result = await p.callLog.updateMany({
      where: voicemailWhere,
      data: { outcome: CallOutcome.NOT_PICKED },
    });
    console.log(`Fixed ${result.count} voicemail record(s) → NOT_PICKED`);
  }

  // ── 2. Not reachable → SWITCHED_OFF ───────────────────────────────────────
  // Covers: "not reachable", "not reached", "unreachable", "number not reachable",
  //         "switched off", "switch off" (common mis-spellings in Indian English)
  const notReachablePatterns = [
    "not reachable",
    "not reached",
    "unreachable",
    "switched off",
    "switch off",
    "swtiched off",   // common typo
    "out of coverage",
    "out of reach",
  ];

  for (const pattern of notReachablePatterns) {
    const where = {
      outcome: CallOutcome.CONNECTED,
      notes: { contains: pattern, mode: "insensitive" as const },
    };

    if (DRY_RUN) {
      const count = await p.callLog.count({ where });
      if (count > 0) console.log(`[DRY] Would fix ${count} record(s) with "${pattern}" → SWITCHED_OFF`);
    } else {
      const result = await p.callLog.updateMany({
        where,
        data: { outcome: CallOutcome.SWITCHED_OFF },
      });
      if (result.count > 0) console.log(`Fixed ${result.count} record(s) with "${pattern}" → SWITCHED_OFF`);
    }
  }

  console.log("Done.");
  await p.$disconnect();
})();

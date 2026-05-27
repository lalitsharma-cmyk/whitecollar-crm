// Nightly behavioural re-score sweep.
//
// Cron: "0 3 * * *" = 03:00 UTC = 08:30 IST (see vercel.json).
// Walks every open lead (status not in WON/LOST) and runs the same
// behavioural rescorer used by per-event hooks. Catches the case where
// time-decay signals (no contact in 30 days) wouldn't otherwise fire,
// since no user action triggers them.
//
// Auth: bearer CRON_SECRET (matches existing pattern in morning-reminder).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rescoreLead } from "@/lib/leadRescorer";
import { LeadStatus } from "@prisma/client";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("rescore-all");
  try {
  // Process ids only — avoids loading whole rows just to discard them.
  const leads = await prisma.lead.findMany({
    where: { status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
    select: { id: true },
  });

  let scanned = 0;
  let changed = 0;
  let belowThreshold = 0;
  let errored = 0;

  // Sequential to keep DB pressure predictable on Neon (free tier).
  // Each rescoreLead call is fairly cheap (~3 queries) so this scales to a few thousand leads.
  for (const { id } of leads) {
    scanned++;
    try {
      const r = await rescoreLead(id);
      if (r.changedBy !== 0) changed++;
      else if (r.skippedBelowThreshold) belowThreshold++;
    } catch {
      errored++;
    }
  }

  await finishCronRun(runId, "OK", undefined, { scanned, changed, belowThreshold, errored });
  return NextResponse.json({
    ok: true,
    scanned,
    changed,
    belowThreshold,
    errored,
  });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

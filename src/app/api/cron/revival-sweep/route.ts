// Daily revival sweep — Agent I.
//
// Wakes up once a day and runs runRevivalSweep(): for every lead that is
// currently COLD but had previously been HOT, and which has a fresh inbound
// signal in the last 24h, bumps the bucket back to WARM and pings the owner.
//
// Auth: bearer CRON_SECRET (matches rescore-all/morning-reminder pattern).
// Schedule: registered in .github/workflows/cron.yml (vercel.json is already
// at the Hobby-plan 2-cron limit — see AGENTS.md).

import { NextResponse, type NextRequest } from "next/server";
import { runRevivalSweep } from "@/lib/revivalEngine";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("revival-sweep");
  try {
    const result = await runRevivalSweep();
    await finishCronRun(runId, "OK", undefined, {
      scanned: result.scanned,
      revived: result.revived,
    });
    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      revived: result.revived,
      revivedLeadIds: result.revivedLeadIds,
    });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

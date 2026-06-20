// Sales follow-up auto-rollover — nightly 9 PM IST (GitHub Actions cron
// "30 15 * * *" → 21:00 IST). Moves pending today-or-earlier follow-ups to the
// next day so stale dates never pile up. See src/lib/followupRollover.ts for the
// safety rules (closed/rejected/deleted/no-followup/HR excluded; remarks never
// touched; every move recorded in LeadFieldHistory).
//
// Auth: bearer CRON_SECRET (same pattern as every other /api/cron route).
// ?dryRun=1 returns the plan (count + sample) WITHOUT writing — for verification.

import { NextResponse, type NextRequest } from "next/server";
import { runFollowupRollover } from "@/lib/followupRollover";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const runId = await startCronRun("followup-rollover");
  try {
    const result = await runFollowupRollover(new Date(), { dryRun });
    await finishCronRun(runId, "OK", undefined, { moved: result.moved, dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

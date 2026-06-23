// Daily buyer auto-distribution — runs via GitHub Actions cron (the 2 Vercel
// hobby cron slots are full: morning + evening reminders). Round-robins every
// ADMIN_POOL buyer across the active team WHEN the admin toggle is ON. Idempotent
// + safe: only ADMIN_POOL buyers are touched, so re-running just distributes the
// remaining pool; when the toggle is OFF it does nothing. See buyerDistribution.ts.
//
// Auth: bearer CRON_SECRET (same pattern as every other /api/cron route).
// ?dryRun=1 returns the plan (per-agent counts) WITHOUT assigning — for verification.

import { NextResponse, type NextRequest } from "next/server";
import { runBuyerDailyDistribute } from "@/lib/buyerDistribution";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const runId = await startCronRun("buyer-distribute");
  try {
    const result = await runBuyerDailyDistribute({ dryRun });
    await finishCronRun(runId, "OK", undefined, { ran: result.ran, reason: result.reason, totalAssigned: result.totalAssigned, dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

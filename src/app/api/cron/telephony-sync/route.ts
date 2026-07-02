// Telephony sync cron — reconciles calls the provider has but we missed a webhook
// for. Idempotent (re-seeing a known call is a no-op). Dispatched by /api/cron/warm
// (~every 30 min). No-op when telephony isn't configured. Auth: bearer CRON_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { syncRecentCalls } from "@/lib/telephony/syncEngine";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = await startCronRun("telephony-sync");
  try {
    const res = await syncRecentCalls();
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

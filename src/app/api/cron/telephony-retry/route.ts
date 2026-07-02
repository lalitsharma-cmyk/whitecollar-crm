// Telephony retry cron — drains the CallSyncTask queue (failed webhooks / dials /
// syncs) with exponential backoff. Dispatched by /api/cron/warm (~every 5 min).
// No-op when the queue is empty. Auth: bearer CRON_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { processQueue } from "@/lib/telephony/retryQueue";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = await startCronRun("telephony-retry");
  try {
    const res = await processQueue();
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

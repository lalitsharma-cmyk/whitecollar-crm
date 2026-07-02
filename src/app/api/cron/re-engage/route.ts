// Future Re-engage cron — reactivate leads whose scheduled re-engage date has
// arrived (reassign back to owner-at-reject / Lalit, notify). Dispatched by the
// /api/cron/warm heartbeat (~daily). Auth: bearer CRON_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { runReEngageDue } from "@/lib/reEngage";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = await startCronRun("re-engage");
  try {
    const res = await runReEngageDue();
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

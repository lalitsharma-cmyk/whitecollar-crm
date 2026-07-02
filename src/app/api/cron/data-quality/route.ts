// Data-quality scan cron (Lalit-approved safe cron). Detect + notify only; never
// mutates data. Dispatched by the /api/cron/warm heartbeat (~twice daily).
// Auth: bearer CRON_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { runDataQualityScan } from "@/lib/dataQuality";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = await startCronRun("data-quality");
  try {
    const res = await runDataQualityScan();
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

// SV-2 — nudge agents who left a site visit / meeting field-status open too long
// (2h/4h reminders → 6h Requires-Review + manager escalation). Dispatched by the
// /api/cron/warm heartbeat (~every 15 min). Idempotent + notification-only.
// Auth: bearer CRON_SECRET.

import { NextResponse, type NextRequest } from "next/server";
import { runSiteVisitWatch } from "@/lib/siteVisitWatch";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runId = await startCronRun("site-visit-watch");
  try {
    const res = await runSiteVisitWatch(new Date());
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

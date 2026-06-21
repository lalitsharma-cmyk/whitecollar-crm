// Lunch-break reminder cron. Called by GitHub Actions twice daily:
//   ?phase=start   → 2:00 PM IST (08:30 UTC) — "Lunch Break Started"
//   ?phase=ending  → 2:25 PM IST (08:55 UTC) — "5 minutes remaining"
//
// Notification-only — no lead/attendance data touched. Auth: bearer CRON_SECRET.
// See src/lib/lunchReminder.ts for the message copy + recipient set.
import { NextResponse, type NextRequest } from "next/server";
import { runLunchReminder, type LunchPhase } from "@/lib/lunchReminder";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phaseParam = new URL(req.url).searchParams.get("phase");
  const phase: LunchPhase = phaseParam === "ending" ? "ending" : "start";
  const runId = await startCronRun(`lunch-${phase}`);
  try {
    const res = await runLunchReminder(phase);
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

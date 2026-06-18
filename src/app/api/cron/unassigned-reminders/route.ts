// Unassigned-lead reminder cron.
//
//   default       → escalation pass (call every 5 min via GitHub Actions):
//                   nudges ADMINs at 15 / 30 / 60 min for real-time inbound
//                   leads still without an owner.
//   ?summary=1    → end-of-day summary (call once daily ~20:00 IST):
//                   one "N still unassigned" digest to ADMINs.
//
// Notification-only — no lead data is touched. Auth: bearer CRON_SECRET.
// See src/lib/unassignedReminders.ts for the logic + dedupe rationale.

import { NextResponse, type NextRequest } from "next/server";
import { runUnassignedEscalation, runUnassignedSummary } from "@/lib/unassignedReminders";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isSummary = new URL(req.url).searchParams.get("summary") === "1";
  const runId = await startCronRun(isSummary ? "unassigned-summary" : "unassigned-escalation");
  try {
    const res = isSummary ? await runUnassignedSummary() : await runUnassignedEscalation();
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

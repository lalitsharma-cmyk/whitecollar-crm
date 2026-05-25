// Cron sweep — dispatches any PENDING WorkflowRun whose runAt is past.
// Hit every minute by a Vercel cron (configured in vercel.json).
import { NextResponse, type NextRequest } from "next/server";
import { dispatchDuePendingActions } from "@/lib/workflowEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await dispatchDuePendingActions();
  return NextResponse.json({ ok: true, ...r });
}

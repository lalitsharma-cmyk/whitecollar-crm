// FREE alternative to Neon Launch tier ($19/mo).
// A tiny pinger hit every few minutes (UptimeRobot / external cron) to keep the
// Neon DB connection warm so it doesn't scale-to-zero.
// Public endpoint — no auth needed; doesn't reveal any data.
//
// HEARTBEAT DISPATCHER (2026-07-02): the GitHub-Actions cron schedule stopped
// firing (see project cron-outage note), but this endpoint IS hit reliably every
// ~2 min by the external pinger. So we piggyback the agent-critical SUB-DAILY crons
// here — meeting/callback reminders + unassigned-lead escalation. ONLY pure-
// notification, idempotent jobs run here; one per tick, throttled by last-run so a
// frequently-hit (public) endpoint can never spam. Data-mutating / sending jobs
// (drip workflows, backups, buyer-distribution) are deliberately NOT auto-run here.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startCronRun, finishCronRun, cronDueMinutes } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// path = the /api/cron/<path> route to hit; name = the CronRun name it logs under
// (used for throttling — must match what the route passes to startCronRun).
const HEARTBEAT_JOBS: Array<{ path: string; name: string; everyMin: number }> = [
  { path: "pre-meeting-reminder", name: "pre-meeting-reminder", everyMin: 5 },
  { path: "unassigned-reminders", name: "unassigned-escalation", everyMin: 5 },
  { path: "site-visit-watch", name: "site-visit-watch", everyMin: 15 },
];

/** Run at most ONE due sub-daily job this tick (keeps warm fast). Best-effort. */
async function dispatchDueHeartbeatJob(): Promise<string | null> {
  const secret = process.env.CRON_SECRET;
  const base = process.env.PUBLIC_BASE_URL || "https://crm.whitecollarrealty.com";
  for (const job of HEARTBEAT_JOBS) {
    if (!(await cronDueMinutes(job.name, job.everyMin))) continue;
    try {
      await fetch(`${base}/api/cron/${job.path}`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // The dispatched job logs its own CronRun; a fetch timeout/error here is
      // non-fatal — jobs are idempotent, so a partial run won't double-notify.
    }
    return job.name; // one job per tick
  }
  return null;
}

export async function GET() {
  const runId = await startCronRun("warm");
  try {
    // Trivial query just to keep the connection pool warm.
    const t = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    await finishCronRun(runId, "OK");
    // Heartbeat: run at most one due sub-daily cron this tick.
    const dispatched = await dispatchDueHeartbeatJob().catch(() => null);
    return NextResponse.json({ ok: true, now: t[0]?.now ?? new Date(), dispatched });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

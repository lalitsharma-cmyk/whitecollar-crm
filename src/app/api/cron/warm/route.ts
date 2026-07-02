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
import { startCronRun, finishCronRun, cronDueMinutes, cronRanTodayIST } from "@/lib/cronRun";
import { hourInTZ } from "@/lib/datetime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// path = the /api/cron/<path> route to hit; name = the CronRun name it logs under
// (used for throttling — must match what the route passes to startCronRun).
const HEARTBEAT_JOBS: Array<{ path: string; name: string; everyMin: number }> = [
  { path: "pre-meeting-reminder", name: "pre-meeting-reminder", everyMin: 5 },
  { path: "unassigned-reminders", name: "unassigned-escalation", everyMin: 5 },
  { path: "site-visit-watch", name: "site-visit-watch", everyMin: 15 },
  { path: "data-quality", name: "data-quality", everyMin: 720 }, // ~twice daily — detect + notify only
  { path: "re-engage", name: "re-engage", everyMin: 360 }, // ~every 6h — reactivate due re-engage leads
];

// DAILY jobs that ALSO have a Vercel-native cron (vercel.json) — but Vercel Hobby
// crons are best-effort and silently skip (evening-reminder missed 2026-07-01). We
// run them here as a BACKUP: fire once/day AFTER the IST hour, but ONLY if no run
// exists for today (cronRanTodayIST) — so when Vercel's native cron DID fire, this
// is a no-op and we never double-notify. afterIstHour matches the vercel.json time.
const DAILY_BACKUP_JOBS: Array<{ path: string; name: string; afterIstHour: number }> = [
  { path: "morning-reminder", name: "morning-reminder", afterIstHour: 10 }, // vercel 04:30 UTC
  { path: "evening-reminder", name: "evening-reminder", afterIstHour: 18 }, // vercel 12:30 UTC
  // Nightly follow-up rollover — NO Vercel cron (Hobby caps at 2), so the heartbeat is
  // the PRIMARY trigger: fires once/day after ~23:00 IST (end of the working day) so
  // today's still-open follow-ups are never bumped early. Idempotent (cronRanTodayIST).
  { path: "followup-rollover", name: "followup-rollover", afterIstHour: 23 },
];

const IST = "Asia/Kolkata";

/** Run at most ONE due job this tick (keeps warm fast). Best-effort. Daily backups
 *  are checked first — they're due at most once/day and self-skip once fired, so
 *  they "steal" only one tick/day and never starve the sub-daily jobs. */
async function dispatchDueHeartbeatJob(): Promise<string | null> {
  const secret = process.env.CRON_SECRET;
  const base = process.env.PUBLIC_BASE_URL || "https://crm.whitecollarrealty.com";
  const hit = async (path: string) => {
    try {
      await fetch(`${base}/api/cron/${path}`, {
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // The dispatched job logs its own CronRun; a fetch timeout/error here is
      // non-fatal — jobs are idempotent, so a partial run won't double-notify.
    }
  };

  // 1) Daily-native backups (morning/evening) — fire after the IST hour iff no run today.
  const istHour = hourInTZ(new Date(), IST);
  for (const job of DAILY_BACKUP_JOBS) {
    if (istHour < job.afterIstHour) continue;
    if (await cronRanTodayIST(job.name)) continue; // Vercel already ran it → skip (no double-notify)
    await hit(job.path);
    return `${job.name} (daily-backup)`;
  }

  // 2) Sub-daily jobs — throttled by last-run.
  for (const job of HEARTBEAT_JOBS) {
    if (!(await cronDueMinutes(job.name, job.everyMin))) continue;
    await hit(job.path);
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

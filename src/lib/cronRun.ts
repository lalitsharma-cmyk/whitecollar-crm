// Tiny health-log helper for /api/cron/* jobs.
//
// Each cron route wraps its handler with:
//   const runId = await startCronRun("morning-reminder");
//   try { /* ... existing work ... */;
//         await finishCronRun(runId, "OK", undefined, { processed: N }); }
//   catch (e) { await finishCronRun(runId, "ERROR", String(e)); throw e; }
//
// Rows are written to the CronRun table and surfaced on /admin/cron-health
// so non-technical admins can see at a glance whether each scheduled job ran
// today and whether it succeeded.
//
// Important: helper failures must NEVER crash the calling cron. If the DB is
// down (which would also break the cron itself), we still want the cron to
// run its actual work. So both functions swallow errors with console.warn.
import { prisma } from "@/lib/prisma";

export async function startCronRun(name: string): Promise<string> {
  try {
    const row = await prisma.cronRun.create({
      data: { name, status: "RUNNING" },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    console.warn(`[cronRun] startCronRun(${name}) failed:`, e);
    return ""; // empty id → finishCronRun is a no-op
  }
}

export async function finishCronRun(
  id: string,
  status: "OK" | "ERROR",
  error?: string,
  meta?: object,
): Promise<void> {
  if (!id) return;
  try {
    await prisma.cronRun.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        // Trim long stack traces so the page stays readable.
        error: error ? error.slice(0, 2000) : null,
        meta: meta ? JSON.stringify(meta).slice(0, 4000) : null,
      },
    });
  } catch (e) {
    console.warn(`[cronRun] finishCronRun(${id}) failed:`, e);
  }
}

/**
 * True when a job named `name` has NOT started within the last `minutes`. Used by
 * the /api/cron/warm heartbeat to throttle sub-daily jobs it dispatches, so a
 * frequently-hit (public) warm endpoint runs each job at most once per window.
 * Checks the newest CronRun regardless of status, so an in-flight run also blocks a
 * duplicate dispatch. On any DB error returns false (fail-safe: do NOT dispatch).
 */
export async function cronDueMinutes(name: string, minutes: number): Promise<boolean> {
  try {
    const last = await prisma.cronRun.findFirst({
      where: { name },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (!last) return true;
    return Date.now() - last.startedAt.getTime() >= minutes * 60_000;
  } catch (e) {
    console.warn(`[cronRun] cronDueMinutes(${name}) failed:`, e);
    return false;
  }
}

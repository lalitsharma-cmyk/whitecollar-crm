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

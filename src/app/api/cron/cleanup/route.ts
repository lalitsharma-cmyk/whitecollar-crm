// Daily housekeeping — trims transient/operational tables so the DB (and every
// backup) stays lean. Touches ONLY Notification + CronRun. NOTHING else: leads,
// activities, remarks, follow-ups, reminders, audit logs, HR, projects are all
// untouched. Safe for reminders — they dedupe on Activity/Lead flags, never on
// notification rows (verified).
//
// Retention (owner spec):
//   • Notifications: READ ones older than 10 days  → delete
//                    ANY  ones older than 90 days  → delete (catches old unread)
//   • CronRun:       older than 30 days            → delete
//
// "Archive before deletion": this cron is scheduled to run AFTER the daily
// full-database backup (pg_dump → Google Drive, 30 daily + 12 monthly). Every
// row removed here was captured in that day's backup (and Neon's 7-day PITR),
// so it's recoverable for up to a year. Add ?dryRun=1 to preview counts only.
//
// Auth: bearer CRON_SECRET.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const now = Date.now();
  const readCutoff = new Date(now - 10 * DAY);  // read notifications: keep 10 days
  const notifCutoff = new Date(now - 90 * DAY); // all notifications: keep 90 days
  const cronCutoff = new Date(now - 30 * DAY);  // CronRun logs: keep 30 days

  // `readAt: { lt: X }` matches only NON-null readAt < X (SQL excludes NULLs),
  // i.e. READ notifications older than 10 days — unread ones are never matched here.
  const readWhere = { readAt: { lt: readCutoff } };
  const oldWhere = { createdAt: { lt: notifCutoff } };
  const cronWhere = { startedAt: { lt: cronCutoff } };

  const runId = await startCronRun(dryRun ? "cleanup-dryrun" : "cleanup");
  try {
    if (dryRun) {
      const [readN, oldN, cronN] = await Promise.all([
        prisma.notification.count({ where: readWhere }),
        prisma.notification.count({ where: oldWhere }),
        prisma.cronRun.count({ where: cronWhere }),
      ]);
      const res = { dryRun: true, wouldDelete: { readNotif10d: readN, anyNotif90d: oldN, cronRun30d: cronN } };
      await finishCronRun(runId, "OK", undefined, res);
      return NextResponse.json(res);
    }

    // Read >10d first, then the 90-day sweep (catches old unread), then CronRun.
    const readDel = await prisma.notification.deleteMany({ where: readWhere });
    const oldDel = await prisma.notification.deleteMany({ where: oldWhere });
    const cronDel = await prisma.cronRun.deleteMany({ where: { ...cronWhere, id: { not: runId } } });

    const res = {
      ok: true,
      deleted: { readNotif10d: readDel.count, anyNotif90d: oldDel.count, cronRun30d: cronDel.count },
    };
    await finishCronRun(runId, "OK", undefined, res);
    return NextResponse.json(res);
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

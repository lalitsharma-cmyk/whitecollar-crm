// Admin-only system health dashboard.
//
// One-glance view of the CRM's vital signs: database row totals,
// last-24h activity, push subscriber coverage, auth health, and a
// pointer to the dedicated cron-health page (shipped wave 11).
//
// Every query here is a cheap COUNT (no findMany on large tables),
// fanned out in parallel via Promise.all so the page renders fast
// even as Lead / CallLog / Activity row counts grow into the
// hundreds of thousands. No raw SQL — pg_total_relation_size byte
// counts are intentionally skipped; row counts are enough signal.

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { fmtIST12 } from "@/lib/datetime";
import Link from "next/link";

export const dynamic = "force-dynamic";

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-bold mt-1 leading-tight">{value}</div>
      {hint && <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">
        {title}
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{children}</div>
    </div>
  );
}

export default async function SystemHealthPage() {
  await requireRole("ADMIN");

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Fan out every count in parallel. All are O(table scan with index) at
  // worst — Postgres reverse-counts are cheap on tables this size.
  const [
    // Database row totals
    leadsTotal,
    callLogsTotal,
    activitiesTotal,
    notesTotal,
    usersActive,
    usersTotal,
    notifsTotal,
    notifsUnread,
    waMessagesTotal,
    auditLogsTotal,
    // 24h activity
    leadsLast24,
    callsLast24,
    followupsDoneLast24,
    meetingsBookedLast24,
    bookingsDoneLast24,
    // Push subscribers
    pushSubs,
    // Auth health
    recentLoginUsers,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.callLog.count(),
    prisma.activity.count(),
    prisma.note.count(),
    prisma.user.count({ where: { active: true } }),
    prisma.user.count(),
    prisma.notification.count(),
    prisma.notification.count({ where: { readAt: null } }),
    prisma.whatsAppMessage.count(),
    prisma.auditLog.count(),
    prisma.lead.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.callLog.count({ where: { startedAt: { gte: dayAgo } } }),
    prisma.activity.count({
      where: {
        status: "DONE",
        completedAt: { gte: dayAgo },
      },
    }),
    prisma.activity.count({
      where: {
        type: { in: ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT", "HOME_VISIT"] },
        createdAt: { gte: dayAgo },
      },
    }),
    prisma.lead.count({ where: { bookingDoneAt: { gte: dayAgo } } }),
    prisma.pushSubscription.findMany({
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.auditLog.findMany({
      where: {
        action: "auth.login.success",
        createdAt: { gte: weekAgo },
        userId: { not: null },
      },
      distinct: ["userId"],
      select: { userId: true },
    }),
  ]);

  const pushSubscriberCount = pushSubs.length;
  const recentLoginCount = recentLoginUsers.length;
  const notifsRead = notifsTotal - notifsUnread;

  return (
    <>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">💚 System Health</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Database, activity, push delivery, and auth signals at a glance.
          </p>
        </div>
        <Link
          href="/admin/health"
          prefetch={false}
          className="chip chip-lost text-xs"
        >
          🔄 Refresh
        </Link>
      </div>

      <Section title="Database">
        <Tile label="Leads" value={leadsTotal.toLocaleString()} />
        <Tile label="Call logs" value={callLogsTotal.toLocaleString()} />
        <Tile label="Activities" value={activitiesTotal.toLocaleString()} />
        <Tile label="Notes" value={notesTotal.toLocaleString()} />
        <Tile
          label="Users"
          value={`${usersActive} / ${usersTotal}`}
          hint="active / total"
        />
        <Tile
          label="Notifications"
          value={notifsTotal.toLocaleString()}
          hint={`${notifsRead.toLocaleString()} read · ${notifsUnread.toLocaleString()} unread`}
        />
        <Tile
          label="WhatsApp msgs"
          value={waMessagesTotal.toLocaleString()}
        />
        <Tile label="Audit log" value={auditLogsTotal.toLocaleString()} />
      </Section>

      <Section title="Last 24 hours">
        <Tile label="New leads" value={leadsLast24.toLocaleString()} />
        <Tile label="Calls made" value={callsLast24.toLocaleString()} />
        <Tile
          label="Follow-ups done"
          value={followupsDoneLast24.toLocaleString()}
        />
        <Tile
          label="Meetings booked"
          value={meetingsBookedLast24.toLocaleString()}
        />
        <Tile label="Bookings done" value={bookingsDoneLast24.toLocaleString()} />
      </Section>

      <Section title="Delivery & Auth">
        <Tile
          label="Push subscribers"
          value={pushSubscriberCount}
          hint={`of ${usersActive} active users`}
        />
        <Tile
          label="Logged in (7d)"
          value={recentLoginCount}
          hint={`of ${usersActive} active users`}
        />
        <div className="card p-3 flex flex-col justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
              Cron jobs
            </div>
            <div className="text-sm font-bold mt-1">Scheduled job status</div>
            <div className="text-[11px] text-gray-500 mt-0.5">
              Last-run + freshness for every cron.
            </div>
          </div>
          <Link
            href="/admin/cron-health"
            className="chip chip-warm text-xs self-start mt-2"
          >
            🩺 Open cron health →
          </Link>
        </div>
      </Section>

      <div className="text-[11px] text-gray-500 pt-2 border-t border-gray-100">
        Last refreshed: {fmtIST12(now)} IST ·{" "}
        <Link
          href="/admin/health"
          prefetch={false}
          className="text-[#0b1a33] underline"
        >
          🔄 Refresh
        </Link>
      </div>
    </>
  );
}

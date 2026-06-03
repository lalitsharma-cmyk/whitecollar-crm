import { prisma } from "@/lib/prisma";
import { LeadStatus, LeadSource, AIScore, CallOutcome, ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { fmtIST12, smartRangeLabel } from "@/lib/datetime";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import { runReconciler } from "@/lib/reconciler";
import { getTestingModeEnabled } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import Link from "next/link";
import IamHereCard from "@/components/IamHereCard";
import CallTargetWidget from "@/components/CallTargetWidget";
import TeamDailyTargetTile from "@/components/TeamDailyTargetTile";
import { todayIST } from "@/lib/attendance";
import { normalizeTeam } from "@/lib/teamRouting";
import TeamScoreboardCard from "@/components/TeamScoreboardCard";
import WeeklySummaryCard from "@/components/WeeklySummaryCard";
import TeamFollowupsWidget from "@/components/TeamFollowupsWidget";

export const dynamic = "force-dynamic";


export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  runReconciler().catch(() => {});
  const todayStart = startOfDay(new Date());
  // Calendar-month start — reused as the lower bound for the "this month"
  // KPIs below AND as the smartRangeLabel input so the sub-text matches the
  // actual window the count is over (no more hard-coded "last 30 days").
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  const monthRangeLabel = smartRangeLabel(monthStart, new Date());

  // ── Team-scoped view ───────────────────────────────────────────────
  // Admin     → default to their own team, can toggle via ?team=Dubai / India / all
  // Manager   → locked to their own team (no toggle, same as AGENT for view)
  // Agent     → locked to their team (no toggle)
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const view =
    me.role === "ADMIN"
      ? (sp.team === "India" ? "India" : sp.team === "Dubai" ? "Dubai" : sp.team === "all" ? "all" : (me.team === "India" ? "India" : me.team === "Dubai" ? "Dubai" : "all"))
      : (me.team === "India" ? "India" : "Dubai"); // MANAGER + AGENT locked to own team

  const teamScope: Prisma.LeadWhereInput = view === "all" ? {} : { forwardedTeam: view };
  // For activity / call queries we need to scope through lead.forwardedTeam
  const teamActWhere: Prisma.ActivityWhereInput = view === "all" ? {} : { lead: { forwardedTeam: view } };
  const teamCallWhere: Prisma.CallLogWhereInput = view === "all" ? {} : { lead: { forwardedTeam: view } };

  // ── Personal scope (audit B-03 / P1-4) ─────────────────────────────
  // An AGENT's KPI hero tiles must count THEIR OWN book — otherwise "Total
  // clients / Calls today / Ready to close / follow-ups" silently include
  // teammates' work and overstate the agent's numbers. ADMIN/MANAGER keep the
  // team view (their dashboard is a leadership console), so for them meScope
  // === teamScope and the dashboard is byte-for-byte unchanged. BY DESIGN these
  // stay team-wide for everyone: the team-distribution chart (leadsByTeam) and
  // the explicitly-labelled "TEAM · THIS MONTH" funnel counts.
  const meScope: Prisma.LeadWhereInput = isAdminOrMgr ? teamScope : { ownerId: me.id };
  const meActWhere: Prisma.ActivityWhereInput = isAdminOrMgr ? teamActWhere : { userId: me.id };
  const meCallWhere: Prisma.CallLogWhereInput = isAdminOrMgr ? teamCallWhere : { userId: me.id };
  // WhatsApp touches (audit B-04): the tile previously counted company-wide and
  // ignored the team filter entirely. Now agent → own leads' messages,
  // leadership → selected team (all → no filter). WhatsAppMessage links to Lead
  // via optional leadId, so we scope through the relation.
  const meWaWhere: Prisma.WhatsAppMessageWhereInput =
    !isAdminOrMgr ? { lead: { ownerId: me.id } } :
    view === "all" ? {} :
    { lead: { forwardedTeam: view } };

  // IST today window for today's follow-up leads widget
  const nowUtc = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayIstMidnight = new Date(Math.floor((nowUtc.getTime() + istOffset) / 86400000) * 86400000 - istOffset);
  const tomorrowIstMidnight = new Date(todayIstMidnight.getTime() + 86400000);

  const [
    totalClients, totalNotContacted, newToday, hotLeads,
    callsToday, connectedToday, waToday,
    followupsDueToday, followupsOverdue, readyToClose, needsYou,
    upcoming,
    // Team-specific KPIs
    expoMeetingsThisMonth, homeVisitsThisMonth, virtualThisMonth, officeThisMonth, siteVisitsThisMonth,
    coldPromotedThisMonth, callsThisMonth,
    todayCallsCount,
    todayFollowups,
  ] = await Promise.all([
    // Personal KPI tiles (audit B-03): me* scopes → the agent's own book;
    // identical to the team scopes for ADMIN/MANAGER (no change for them).
    prisma.lead.count({ where: meScope }),
    prisma.lead.count({ where: { ...meScope, status: LeadStatus.NEW } }),
    prisma.lead.count({ where: { ...meScope, createdAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { ...meScope, aiScore: AIScore.HOT } }),
    prisma.callLog.count({ where: { ...meCallWhere, startedAt: { gte: todayStart } } }),
    prisma.callLog.count({ where: { ...meCallWhere, startedAt: { gte: todayStart }, outcome: CallOutcome.CONNECTED } }),
    prisma.whatsAppMessage.count({ where: { ...meWaWhere, receivedAt: { gte: todayStart } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: "CALL", scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600 * 1000) } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { lt: todayStart } } }),
    prisma.lead.count({ where: { ...meScope, status: { in: [LeadStatus.NEGOTIATION, LeadStatus.SITE_VISIT] } } }),
    prisma.lead.count({ where: { ...meScope, needsManagerReview: true, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } }),
    prisma.activity.findMany({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 5, include: { lead: { select: { id: true, name: true } } } }), // B-15: only lead.id/name rendered
    // Team funnel counts (this month) — feed the explicitly-labelled
    // "TEAM · THIS MONTH" section, so they stay TEAM-scoped for everyone.
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.EXPO_MEETING, completedAt: { gte: monthStart } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.HOME_VISIT, completedAt: { gte: monthStart } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.VIRTUAL_MEETING, completedAt: { gte: monthStart } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.OFFICE_MEETING, completedAt: { gte: monthStart } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.SITE_VISIT, completedAt: { gte: monthStart } } }),
    // Cold→Lead conversions THIS MONTH (team-scoped) — matches the sibling
    // "THIS MONTH" tiles in this block (Lalit: count the whole month, not today).
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.COLD_TO_LEAD, completedAt: { gte: monthStart } } }),
    // Calls this month — true month-to-date count for the "Calls (mo)" tile
    // (audit B-05; the tile previously showed callsToday mislabelled "(mo)").
    prisma.callLog.count({ where: { ...teamCallWhere, startedAt: { gte: monthStart } } }),
    // Today's actual calls logged (by this user, IST window) — feeds CallTargetWidget
    prisma.callLog.count({
      where: {
        userId: me.id,
        startedAt: { gte: todayIstMidnight, lt: tomorrowIstMidnight },
      },
    }),
    // Today's follow-up leads widget — leads with followupDate within today (IST)
    prisma.lead.findMany({
      where: {
        ...meScope,
        followupDate: { gte: todayIstMidnight, lt: tomorrowIstMidnight },
        status: { notIn: ["LOST", "WON"] },
      },
      select: { id: true, name: true, potential: true, followupDate: true, lastTouchedAt: true },
      orderBy: [{ potential: "asc" }, { followupDate: "asc" }],
      take: 5,
    }),
  ]);

  // ── "Today's situation" Command Center hero strip (master spec §9.1) ──
  // Action-first tiles answering: what needs attention RIGHT NOW?
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  // These "needs attention RIGHT NOW" hero counts are personal for an agent
  // (their own urgent items) and team-wide for leadership (audit B-03).
  const [hotUntouched, overdueFollowups, closableDeals, coldRevivalOps] = await Promise.all([
    prisma.lead.count({
      where: {
        ...meScope, aiScore: AIScore.HOT,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        OR: [{ lastTouchedAt: { lt: sixHoursAgo } }, { lastTouchedAt: null }],
      },
    }),
    prisma.lead.count({
      where: {
        ...meScope, followupDate: { lt: new Date(), not: null },
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
      },
    }),
    prisma.lead.count({
      where: { ...meScope, status: LeadStatus.NEGOTIATION, eoiStage: { not: null } },
    }),
    prisma.lead.count({
      where: {
        ...meScope, isColdCall: true,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        lastTouchedAt: { lt: thirtyDaysAgo },
        OR: [{ budgetMin: { gt: 5_000_000 } }, { aiScore: AIScore.HOT }],
      },
    }),
  ]);

  // Today's attendance for THIS user
  const myAttendanceToday = await prisma.attendance.findUnique({
    where: { userId_date: { userId: me.id, date: todayIST() } },
  });

  // ADMIN-only morning-window widget: overnight leads waiting for assign
  let morningQueueCount = 0;
  let morningQueueLeads: Array<{ id: string; name: string; phone: string | null; createdAt: Date; forwardedTeam: string | null }> = [];
  if (me.role === "ADMIN") {
    // Created after 10pm yesterday IST AND still unassigned today
    const cutoff = new Date(Date.now() - 14 * 3600 * 1000); // last 14 hours
    morningQueueLeads = await prisma.lead.findMany({
      where: { ownerId: null, isColdCall: false, createdAt: { gte: cutoff }, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
      select: { id: true, name: true, phone: true, createdAt: true, forwardedTeam: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    morningQueueCount = morningQueueLeads.length;
  }

  const connectRate = callsToday ? Math.round((connectedToday / callsToday) * 100) : 0;

  // ── Weekly pipeline summary — ADMIN / MANAGER only ───────────────────
  // IST week boundaries: Mon midnight IST → Sun midnight IST
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + istOffsetMs);
  const dayOfWeek = nowIst.getUTCDay(); // 0=Sun, 1=Mon...
  const daysFromMonday = (dayOfWeek + 6) % 7;
  const thisWeekMonday = new Date(
    Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate() - daysFromMonday)
    - istOffsetMs
  );
  const lastWeekMonday = new Date(thisWeekMonday.getTime() - 7 * 24 * 3600 * 1000);

  let weeklyMetrics: Array<{ label: string; thisWeek: number; lastWeek: number }> = [];
  if (isAdminOrMgr) {
    const [thisWeekStats, lastWeekStats] = await Promise.all([
      Promise.all([
        prisma.lead.count({ where: { ...teamScope, createdAt: { gte: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: { notIn: ["NEW", "LOST"] }, updatedAt: { gte: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: { in: ["QUALIFIED", "SITE_VISIT", "NEGOTIATION", "EOI", "BOOKING_DONE", "WON"] }, updatedAt: { gte: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: "WON", updatedAt: { gte: thisWeekMonday } } }),
      ]),
      Promise.all([
        prisma.lead.count({ where: { ...teamScope, createdAt: { gte: lastWeekMonday, lt: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: { notIn: ["NEW", "LOST"] }, updatedAt: { gte: lastWeekMonday, lt: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: { in: ["QUALIFIED", "SITE_VISIT", "NEGOTIATION", "EOI", "BOOKING_DONE", "WON"] }, updatedAt: { gte: lastWeekMonday, lt: thisWeekMonday } } }),
        prisma.lead.count({ where: { ...teamScope, status: "WON", updatedAt: { gte: lastWeekMonday, lt: thisWeekMonday } } }),
      ]),
    ]);
    const [thisNew, thisContacted, thisQualified, thisWon] = thisWeekStats;
    const [lastNew, lastContacted, lastQualified, lastWon] = lastWeekStats;
    weeklyMetrics = [
      { label: "New Leads", thisWeek: thisNew, lastWeek: lastNew },
      { label: "Contacted", thisWeek: thisContacted, lastWeek: lastContacted },
      { label: "Qualified+", thisWeek: thisQualified, lastWeek: lastQualified },
      { label: "Won", thisWeek: thisWon, lastWeek: lastWon },
    ];
  }

  // ── Team follow-ups for the rest of this week (IST) ────────────────────
  const endOfWeekIST = new Date(thisWeekMonday.getTime() + 7 * 24 * 3600 * 1000);
  const teamFollowups = isAdminOrMgr
    ? await prisma.lead.findMany({
        where: {
          ...teamScope,
          followupDate: { gte: new Date(), lt: endOfWeekIST },
          status: { notIn: ["LOST", "WON"] },
        },
        orderBy: { followupDate: "asc" },
        take: 20,
        select: {
          id: true,
          name: true,
          followupDate: true,
          potential: true,
          owner: { select: { name: true } },
        },
      })
    : [];

  // ── Team scoreboard — calls made today by each agent ──────────────────
  // Only fetched for ADMIN / MANAGER (competitive data, not for agents).
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team ?? "") : null;
  const teamScoreboard =
    me.role === "ADMIN" || me.role === "MANAGER"
      ? await prisma.callLog.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: {
            startedAt: { gte: todayIstMidnight, lt: tomorrowIstMidnight },
            ...(managerTeam !== null
              ? { user: { team: managerTeam } }
              : {}),
          },
          orderBy: { _count: { userId: "desc" } },
          take: 10,
        })
      : [];

  const scoreboardUserIds = teamScoreboard.map((r) => r.userId);
  const scoreboardUsers =
    scoreboardUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: scoreboardUserIds } },
          select: { id: true, name: true },
        })
      : [];
  const scoreboardRows = teamScoreboard.map((r) => ({
    name: scoreboardUsers.find((u) => u.id === r.userId)?.name ?? "Unknown",
    calls: r._count?._all ?? 0,
  }));

  // ⚡ PERFORMANCE: was 30 sequential queries (5 per agent × 6 agents). Now 1.
  const tomorrow = new Date(todayStart.getTime() + 24 * 3600_000);
  type SpRow = { id: string; name: string; team: string | null; calls: bigint; connected: bigint; due_today: bigint; overdue: bigint; closeable: bigint; needs: bigint; clients: bigint };
  // ADMIN/MANAGER only — this table exposes every teammate's call counts,
  // pipeline & client totals (competitive data). Agents see their own numbers
  // in the KPI tiles + briefing above; the cross-team breakdown is management-
  // only. Skipping the query for agents also avoids 9 sub-selects × N users.
  const spStatsRaw: SpRow[] = isAdminOrMgr ? await prisma.$queryRaw<SpRow[]>`
    SELECT u.id, u.name, u.team,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${todayStart}), 0) as calls,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${todayStart} AND c.outcome::text = 'CONNECTED'), 0) as connected,
      COALESCE((SELECT COUNT(*) FROM "Activity" a WHERE a."userId" = u.id AND a.status::text = 'PLANNED' AND a."scheduledAt" >= ${todayStart} AND a."scheduledAt" < ${tomorrow}), 0) as due_today,
      COALESCE((SELECT COUNT(*) FROM "Activity" a WHERE a."userId" = u.id AND a.status::text = 'PLANNED' AND a."scheduledAt" < ${todayStart}), 0) as overdue,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id AND l.status::text IN ('NEGOTIATION','SITE_VISIT')), 0) as closeable,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id AND l."needsManagerReview" = true), 0) as needs,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id), 0) as clients
    FROM "User" u
    WHERE u.active = true AND u.role::text IN ('AGENT','MANAGER')
    ORDER BY calls DESC
  ` : [];
  const spStats = spStatsRaw.map(r => ({
    id: r.id, name: r.name, team: r.team,
    calls: Number(r.calls), connected: Number(r.connected),
    dueToday: Number(r.due_today), overdue: Number(r.overdue),
    closeable: Number(r.closeable), needs: Number(r.needs), clients: Number(r.clients),
  }));

  const testingModeOn = await getTestingModeEnabled();

  // ── Per-agent morning briefing (also shown to admins) ──
  // What landed since yesterday + what's on the agent's plate today. Mirrors
  // the morning-reminder cron notification but always visible on dashboard so
  // an agent logging in at 10am sees their day at a glance.
  //
  // §12.4 Daily Opening Experience adds:
  //   • Today's mission — the SINGLE most-impactful lead for the agent right
  //     now (priority: hottest untouched > biggest closeable > oldest overdue).
  //   • Time-aware greeting (good morning / afternoon / evening in IST).
  //   • Streak nudge so the daily login + follow-up streak feel rewarded.
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const sixHoursAgoIst = new Date(Date.now() - 6 * 3600_000);
  const [myNewOvernight, myFollowupsToday, myCallbacksToday, todaysMission] = await Promise.all([
    prisma.lead.count({ where: { ownerId: me.id, createdAt: { gte: since24h } } }),
    prisma.activity.count({
      where: {
        userId: me.id,
        status: ActivityStatus.PLANNED,
        scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600_000) },
      },
    }),
    prisma.lead.count({
      where: {
        ownerId: me.id,
        followupDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600_000) },
        status: { notIn: ["WON", "LOST"] },
      },
    }),
    // Today's mission — single highest-impact lead for the agent. We pick
    // by status priority via three sequential cheap finds, taking the first
    // that matches: NEGOTIATION first (close-able money on the table), then
    // hot untouched, then oldest overdue. Each is a one-row .findFirst with
    // an index hit, so cumulative cost is negligible.
    (async () => {
      const candidates = await Promise.all([
        prisma.lead.findFirst({
          where: { ownerId: me.id, status: LeadStatus.NEGOTIATION, eoiStage: { not: null } },
          orderBy: { lastTouchedAt: "desc" },
          select: { id: true, name: true, status: true, budgetMin: true, budgetCurrency: true, lastTouchedAt: true, eoiStage: true },
        }),
        prisma.lead.findFirst({
          where: {
            ownerId: me.id,
            aiScore: AIScore.HOT,
            status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
            OR: [{ lastTouchedAt: { lt: sixHoursAgoIst } }, { lastTouchedAt: null }],
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, status: true, budgetMin: true, budgetCurrency: true, lastTouchedAt: true, eoiStage: true },
        }),
        prisma.lead.findFirst({
          where: {
            ownerId: me.id,
            followupDate: { lt: todayStart },
            status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
          },
          orderBy: { followupDate: "asc" },
          select: { id: true, name: true, status: true, budgetMin: true, budgetCurrency: true, lastTouchedAt: true, eoiStage: true },
        }),
      ]);
      // Tag each candidate with the reason so the UI can show "Why this?"
      const reasons = ["close_eoi", "hot_untouched", "oldest_overdue"] as const;
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i]) return { ...candidates[i]!, reason: reasons[i] };
      }
      return null;
    })(),
  ]);
  const hasMorningWork = myNewOvernight > 0 || myFollowupsToday > 0 || myCallbacksToday > 0;

  // Motivation hook — surface the agent's most recent vault WIN so the morning
  // greeting reminds them of a real recent success (much stickier than a generic
  // quote alone). If they have no wins logged, render nothing — explicit "no
  // wins" copy is demotivating.
  const lastWin = await prisma.vaultEntry.findFirst({
    where: { userId: me.id, kind: "WIN" },
    orderBy: { createdAt: "desc" },
    select: { content: true, createdAt: true },
  });
  const lastWinClipped = lastWin
    ? (lastWin.content.length > 120 ? `${lastWin.content.slice(0, 120).trimEnd()}…` : lastWin.content)
    : null;

  // Time-aware greeting — uses IST hour to pick morning/afternoon/evening.
  // Worth noting: server runs in UTC on Vercel, so we convert explicitly
  // rather than relying on local time on the box.
  const istNow = new Date(Date.now() + 5.5 * 3600_000);
  const istHour = istNow.getUTCHours();
  const greeting =
    istHour < 12 ? "Good morning" :
    istHour < 17 ? "Good afternoon" : "Good evening";
  const energyEmoji =
    istHour < 12 ? "☀️" :
    istHour < 17 ? "⚡" : "🌇";

  // Streak nudge — surface a quick callout if the agent has a meaningful streak.
  // Cap displayed values at 999 so the chip doesn't blow out on long-running
  // accounts. lastStreakDay==today means they've already touched the streak
  // today (no warning needed); blank/old means they're about to break it.
  const dailyStreak = me.dailyStreak ?? 0;
  const followupStreak = me.followupStreak ?? 0;

  return (
    <>
      {testingModeOn && (
        <div className="card p-3 border-l-4 border-amber-500 bg-amber-50 mb-3">
          <div className="text-sm font-semibold text-amber-900">🧪 Testing mode is ON — every auto-action paused</div>
          <div className="text-xs text-amber-800 mt-0.5">
            Round-robin, SLA escalation, "Needs You" flagging, overnight WhatsApp, and speed-to-lead are all suppressed.
            Manual calls/WA still work. <Link href="/settings" className="underline font-semibold">Switch to live mode →</Link>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">
            {view === "Dubai" ? "🇦🇪 Dubai team — Sales Command Center" :
             view === "India" ? "🇮🇳 India team — Sales Command Center" :
             "Sales Command Center (all teams)"}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">{new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} · {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} IST · Live data · <span className="text-[10px] text-gray-400 dark:text-slate-500">v.{(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}</span></p>
        </div>
        <div className="flex gap-2 flex-wrap items-center self-start sm:self-auto">
          {me.role === "ADMIN" && (
            <div className="seg">
              <Link href="/dashboard?team=Dubai" className={view === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
              <Link href="/dashboard?team=India" className={view === "India" ? "on" : ""}>🇮🇳 India</Link>
              <Link href="/dashboard?team=all" className={view === "all" ? "on" : ""}>All</Link>
            </div>
          )}
          {me.role === "MANAGER" && (
            <div className="seg" title="Managers see their own team only">
              <span className={`on cursor-default opacity-80`}>{view === "India" ? "🇮🇳 India" : "🇦🇪 Dubai"}</span>
            </div>
          )}
          <Link
            href="/action-list"
            title="Ready-to-close (NEGOTIATION/SITE_VISIT) + Overdue follow-ups + Manager-flagged leads. Scoped to your leads if agent, all leads if manager/admin."
            className="btn btn-gold justify-center"
          >📋 Action List</Link>
        </div>
      </div>

      {/* ─── "I am here" widget — Agent T (Round 5) ───
          Per Lalit: "Put I am here at top. so user knows its attendance."
          TOP card under the page title (the greeting/quote welcome strip that
          used to sit above this was removed per Lalit "remove daily note" — the
          greeting + daily quote still live in the Daily Opening card below). */}
      <IamHereCard
        today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null}
        userId={me.id}
        userName={me.name}
      />

      {/* Daily call target progress — agent-only personal progress bar */}
      {me.role === "AGENT" && (
        <CallTargetWidget count={todayCallsCount} target={20} />
      )}

      {/* Team daily target — rolling progress vs sum of agent targets.
          Sits above the 4-tile hero strip so the team sees their collective
          goal first, then the action-first tiles below. Hidden for "all". */}
      <TeamDailyTargetTile team={view} todayStart={todayStart} />

      {/* ─── Today's Situation — Sales Command Center hero (§9.1) ───
          Action-first tiles answering: what needs attention RIGHT NOW?
          Each card is a clickable link to the filtered Leads/Pipeline view. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/leads?ai=HOT&when=overdue" className="card p-4 border-l-4 border-red-500 hover:shadow-lg transition active:bg-red-50">
          <div className="text-3xl font-extrabold text-red-700">{hotUntouched}</div>
          <div className="text-xs font-semibold text-red-900 mt-1">🔥 Hot leads untouched</div>
          <div className="text-[10px] text-red-700/70 mt-0.5">No agent activity in 6+ hours</div>
        </Link>
        <Link href="/leads?followup=overdue" className="card p-4 border-l-4 border-orange-500 hover:shadow-lg transition active:bg-orange-50">
          <div className="text-3xl font-extrabold text-orange-700">{overdueFollowups}</div>
          <div className="text-xs font-semibold text-orange-900 mt-1">⏰ Overdue follow-ups</div>
          <div className="text-[10px] text-orange-700/70 mt-0.5">Follow-up date in the past</div>
        </Link>
        <Link href="/pipeline" className="card p-4 border-l-4 border-emerald-500 hover:shadow-lg transition active:bg-emerald-50">
          <div className="text-3xl font-extrabold text-emerald-700">{closableDeals}</div>
          <div className="text-xs font-semibold text-emerald-900 mt-1">💎 Closable deals</div>
          <div className="text-[10px] text-emerald-700/70 mt-0.5">Negotiation + EOI in progress</div>
        </Link>
        <Link href="/cold-calls" className="card p-4 border-l-4 border-blue-500 hover:shadow-lg transition active:bg-blue-50">
          <div className="text-3xl font-extrabold text-blue-700">{coldRevivalOps}</div>
          <div className="text-xs font-semibold text-blue-900 mt-1">🧊 Cold revival opportunities</div>
          <div className="text-[10px] text-blue-700/70 mt-0.5">High-value dormant 30+ days</div>
        </Link>
      </div>

      {/* Today's Calls widget — leads with followupDate due today, scoped to
          the agent's own book (or full team for admin/manager, matching meScope). */}
      {todayFollowups.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">📞 Today&apos;s Calls</h3>
            <a href="/leads?followup=today" className="text-xs text-blue-600 hover:underline">View all →</a>
          </div>
          <div className="space-y-2">
            {todayFollowups.map(lead => (
              <a key={lead.id} href={`/leads/${lead.id}`} className="flex items-center gap-2 hover:bg-gray-50 rounded-lg px-2 py-1 -mx-2">
                <span className="text-sm">{lead.potential === "HIGH" ? "🔥" : lead.potential === "MEDIUM" ? "🌤" : "❄"}</span>
                <span className="text-sm font-medium flex-1 truncate">{lead.name}</span>
                {lead.followupDate && (
                  <span className="text-[11px] text-gray-400">
                    {new Date(lead.followupDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </a>
            ))}
          </div>
          <a href="/leads?followup=today" className="mt-2 block text-xs text-center text-blue-600 hover:underline">
            See all follow-ups for today →
          </a>
        </div>
      )}

      {/* Team live scoreboard — ADMIN / MANAGER only */}
      {(me.role === "ADMIN" || me.role === "MANAGER") && (
        <TeamScoreboardCard rows={scoreboardRows} />
      )}

      {/* Weekly pipeline summary — ADMIN / MANAGER only */}
      {(me.role === "ADMIN" || me.role === "MANAGER") && weeklyMetrics.length > 0 && (
        <WeeklySummaryCard metrics={weeklyMetrics} />
      )}

      {/* Team follow-ups this week — ADMIN / MANAGER only */}
      {(me.role === "ADMIN" || me.role === "MANAGER") && (
        <TeamFollowupsWidget items={teamFollowups} />
      )}

      {/* §12.4 Daily Opening Experience
          Premium morning greeting + single "today's mission" CTA + streak
          nudge + the existing chips + the daily quote. Sits above the Hero
          strip so logging in feels like a sales pep-talk, not a wall of
          numbers. Always visible (not just on cron tick). */}
      <div className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/60 to-white">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-[#0b1a33]">
                {energyEmoji} {greeting}, {me.name.split(" ")[0]}
              </h2>
              {dailyStreak >= 3 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                  🔥 {dailyStreak}-day streak
                </span>
              )}
              {followupStreak >= 3 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                  🎯 {followupStreak}-day follow-up streak
                </span>
              )}
            </div>

            {/* TODAY'S MISSION — single highest-impact card, the spec's flagship
                idea for the daily opener. Picks NEGOTIATION-with-EOI first,
                then hot-untouched, then oldest overdue. */}
            {todaysMission ? (
              <Link
                href={`/leads/${todaysMission.id}`}
                className="block mt-3 rounded-xl border-2 border-[#c9a24b] bg-white px-4 py-3 hover:shadow-lg transition group"
              >
                <div className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
                  🎯 Today's mission
                </div>
                <div className="mt-1 text-sm sm:text-base font-bold text-[#0b1a33] group-hover:underline">
                  {todaysMission.reason === "close_eoi" && "Close this EOI: "}
                  {todaysMission.reason === "hot_untouched" && "Call this hot lead NOW: "}
                  {todaysMission.reason === "oldest_overdue" && "Win back: "}
                  {todaysMission.name}
                </div>
                <div className="text-[11px] text-gray-600 dark:text-slate-300 mt-0.5">
                  {todaysMission.reason === "close_eoi" && `In NEGOTIATION · EOI stage: ${todaysMission.eoiStage ?? "—"} · push for booking`}
                  {todaysMission.reason === "hot_untouched" && `HOT score · ${todaysMission.lastTouchedAt ? `last touched ${formatDistanceToNow(todaysMission.lastTouchedAt, { addSuffix: true })}` : "never touched"} — every hour costs you`}
                  {todaysMission.reason === "oldest_overdue" && `Follow-up overdue — win back trust by reaching out today`}
                  {todaysMission.budgetMin && ` · ${fmtMoney(todaysMission.budgetMin, todaysMission.budgetCurrency === "INR" ? "INR" : "AED")}`}
                </div>
              </Link>
            ) : hasMorningWork ? null : (
              <div className="mt-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-600 px-4 py-3 text-sm text-gray-600 dark:text-slate-300">
                ✨ Inbox zero — no urgent missions right now. Great time to
                revive a cold lead or push a stalled deal forward.
              </div>
            )}

            {hasMorningWork && (
              <div className="flex flex-wrap gap-2 mt-3 text-sm">
                {myNewOvernight > 0 && (
                  <Link href="/leads?when=24h" className="px-3 py-1.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 font-semibold hover:bg-emerald-200 min-h-9 flex items-center gap-1">
                    🆕 {myNewOvernight} new lead{myNewOvernight === 1 ? "" : "s"} since yesterday
                  </Link>
                )}
                {myCallbacksToday > 0 && (
                  <Link href="/action-list" className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-semibold hover:bg-amber-200 min-h-9 flex items-center gap-1">
                    ☎ {myCallbacksToday} client callback{myCallbacksToday === 1 ? "" : "s"} today
                  </Link>
                )}
                {myFollowupsToday > 0 && (
                  <Link href="/activities" className="px-3 py-1.5 rounded-full bg-blue-100 text-blue-900 border border-blue-300 font-semibold hover:bg-blue-200 min-h-9 flex items-center gap-1">
                    📅 {myFollowupsToday} follow-up{myFollowupsToday === 1 ? "" : "s"} to do
                  </Link>
                )}
              </div>
            )}

            {/* Last vault WIN — only renders if the agent has logged one.
                No "no wins yet" fallback — demotivating. */}
            {lastWin && lastWinClipped && (
              <div
                className="text-[12px] text-emerald-800 mt-2 flex items-start gap-1.5 leading-relaxed"
                title="Your most recent entry in the Vault tagged as WIN."
              >
                <span aria-hidden>📈</span>
                <span className="min-w-0">
                  <b>Your last win:</b> {lastWinClipped}
                  <span className="text-[10px] text-gray-500 ml-1">
                    · {formatDistanceToNow(lastWin.createdAt, { addSuffix: true })}
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin-only: leads waiting for morning assignment (15-min window) */}
      {me.role === "ADMIN" && morningQueueCount > 0 && (
        <div className="card p-4 border-l-4 border-red-500 bg-red-50">
          <div className="flex items-center justify-between mb-2">
            <div className="font-bold text-red-900">⏰ {morningQueueCount} lead{morningQueueCount === 1 ? "" : "s"} waiting for your assign</div>
            <div className="text-[10px] text-red-700">After 5 min the system auto-assigns to present agents (round-robin)</div>
          </div>
          <div className="space-y-1">
            {morningQueueLeads.map((l) => (
              <Link key={l.id} href={`/leads/${l.id}`} className="block text-xs p-2 rounded bg-white border border-red-200 hover:border-red-400">
                <b>{l.name}</b> {l.phone && <span className="text-gray-500">· {l.phone}</span>}
                <span className="text-gray-400 ml-2">{l.forwardedTeam ?? "—"} · {formatDistanceToNow(l.createdAt, { addSuffix: true })}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 8 KPI tiles matching your dashboard exactly */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2">TODAY &amp; RIGHT NOW</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2 lg:gap-3">
          <KPI title="Calls Dialed — today" value={callsToday} sub="dials logged today" />
          <KPI title="Calls Connected — today" value={connectedToday} sub={`${connectRate}% connect rate today`} />
          <KPI title="Follow-ups Due — today" value={followupsDueToday} sub="scheduled for today" />
          <KPI title="Overdue Follow-ups — now" value={followupsOverdue} sub="past their follow-up date" />
          <KPI title="Ready to Close — now" value={readyToClose} sub="showing buying signals" />
          <KPI title="Need Your Attention — now" value={needsYou} sub="flagged for manager" highlight={needsYou > 0} />
          <KPI title="WhatsApp Touches — today" value={waToday} sub="messages logged today" />
          <KPI title="Total Clients — all time" value={totalClients} sub={`${totalNotContacted} not yet contacted`} />
        </div>
      </div>

      {/* Team-specific funnel KPIs (this month) */}
      {view !== "all" && (
        <div>
          <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2">
            {view === "Dubai" ? "DUBAI TEAM · THIS MONTH" : "INDIA TEAM · THIS MONTH"}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
            {view === "Dubai" ? (
              <>
                <KPI title="📞 Calls (mo)" value={callsThisMonth} sub={monthRangeLabel} />
                <KPI title="💻 Virtual meets" value={virtualThisMonth} sub={monthRangeLabel} />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub={monthRangeLabel} />
                <KPI title="🎪 Expo meets" value={expoMeetingsThisMonth} sub={`${monthRangeLabel} · expos in IN`} />
                <KPI title="🚗 Dubai site visits" value={siteVisitsThisMonth} sub={`${monthRangeLabel} · w/ developer sales`} />
              </>
            ) : (
              <>
                <KPI title="📞 Calls (mo)" value={callsThisMonth} sub={monthRangeLabel} />
                <KPI title="🚗 Site visits" value={siteVisitsThisMonth} sub={monthRangeLabel} />
                <KPI title="🏠 Home visits" value={homeVisitsThisMonth} sub={monthRangeLabel} />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub={monthRangeLabel} />
                <KPI title="❄→🔥 Cold→Lead" value={coldPromotedThisMonth} sub={`${monthRangeLabel} · conversions`} highlight={coldPromotedThisMonth > 0} />
              </>
            )}
          </div>
        </div>
      )}

      {/* By Salesperson table — ADMIN/MANAGER only (team-wide competitive data) */}
      {isAdminOrMgr && (
      <div className="card p-3 lg:p-5 overflow-x-auto">
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-3">BY SALESPERSON · TEAM</div>
        <table className="tbl w-full min-w-[520px]">
          <thead><tr>
            <th>Salesperson</th><th>Team</th><th className="text-center">Calls today</th><th className="text-center">Connected today</th><th className="text-center">Due today</th><th className="text-center">Overdue now</th><th className="text-center">Closeable now</th><th className="text-center">Needs Lalit</th><th className="text-center">Clients (total)</th>
          </tr></thead>
          <tbody>
            {spStats.map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.name}</td>
                <td><span className={`chip ${s.team === "India" ? "src-csv" : "src-wa"}`}>{s.team ?? "—"}</span></td>
                <td className="text-center">{s.calls}</td>
                <td className="text-center">{s.connected}</td>
                <td className="text-center">{s.dueToday}</td>
                <td className={`text-center ${s.overdue > 0 ? "text-red-600 font-semibold" : ""}`}>{s.overdue}</td>
                <td className="text-center font-semibold">{s.closeable}</td>
                <td className={`text-center ${s.needs > 0 ? "text-amber-600 font-bold" : ""}`}>{s.needs}</td>
                <td className="text-center">{s.clients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Upcoming follow-ups */}
      <div className="card p-5">
        <div className="font-semibold mb-3">Upcoming follow-ups</div>
        <div className="space-y-2">
          {upcoming.map((a) => (
            <Link key={a.id} href={a.lead ? `/leads/${a.lead.id}` : "#"} className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] hover:border-[#c9a24b]">
              <div>
                <div className="text-sm font-semibold">{a.title}{a.lead && ` · ${a.lead.name}`}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400">{a.scheduledAt && `${fmtIST12(a.scheduledAt)} IST`}</div>
              </div>
              <span className="chip chip-new">{a.type}</span>
            </Link>
          ))}
          {upcoming.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">Nothing scheduled.</div>}
        </div>
      </div>
    </>
  );
}

function KPI({ title, value, sub, highlight }: { title: string; value: number; sub: string; highlight?: boolean }) {
  return (
    <div className={`card p-3 lg:p-4 ${highlight ? "border-amber-500 border-2 bg-amber-50 dark:bg-amber-900/20" : ""}`}>
      <div className="text-2xl lg:text-3xl font-bold dark:text-white">{value}</div>
      <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 dark:text-slate-400 uppercase mt-0.5 lg:mt-1 leading-tight">{title}</div>
      <div className="text-[11px] lg:text-xs text-gray-500 dark:text-slate-400 mt-0.5 lg:mt-1 leading-tight">{sub}</div>
    </div>
  );
}

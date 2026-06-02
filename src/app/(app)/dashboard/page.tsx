import { prisma } from "@/lib/prisma";
import { LeadStatus, LeadSource, AIScore, CallOutcome, ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { fmtIST12, smartRangeLabel } from "@/lib/datetime";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import { runReconciler } from "@/lib/reconciler";
import { getTestingModeEnabled } from "@/lib/settings";
import { activityVisual } from "@/lib/activityIcon";
import { requireUser } from "@/lib/auth";
import Link from "next/link";
import MoodCheckIn from "@/components/MoodCheckIn";
import AttendanceBadge from "@/components/AttendanceBadge";
import IamHereCard from "@/components/IamHereCard";
import DailyMissionBoard from "@/components/DailyMissionBoard";
import PersonalScoreboard from "@/components/PersonalScoreboard";
import SmartSuggestionsCard from "@/components/SmartSuggestionsCard";
import AIMotivatorCard from "@/components/AIMotivatorCard";
import TeamDailyTargetTile from "@/components/TeamDailyTargetTile";
import { todayIST } from "@/lib/attendance";
import { quoteOfTheDay } from "@/lib/salesQuotes";

export const dynamic = "force-dynamic";

// Sales forecast weights (matches your dashboard)
const WEIGHTS = { NEGOTIATION: 0.55, SITE_VISIT: 0.30, QUALIFIED: 0.10, CONTACTED: 0.02, NEW: 0.02 };

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
  // Admin/Manager → default to their own team, can toggle via ?team=Dubai / India / all
  // Agent         → locked to their team (no toggle)
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const view =
    !isAdminOrMgr ? (me.team === "India" ? "India" : "Dubai") :
    sp.team === "India" ? "India" :
    sp.team === "Dubai" ? "Dubai" :
    sp.team === "all" ? "all" :
    (me.team === "India" ? "India" : me.team === "Dubai" ? "Dubai" : "all");

  const teamScope: Prisma.LeadWhereInput = view === "all" ? {} : { forwardedTeam: view };
  // For activity / call queries we need to scope through lead.forwardedTeam
  const teamActWhere: Prisma.ActivityWhereInput = view === "all" ? {} : { lead: { forwardedTeam: view } };
  const teamCallWhere: Prisma.CallLogWhereInput = view === "all" ? {} : { lead: { forwardedTeam: view } };

  const [
    totalClients, totalNotContacted, newToday, hotLeads,
    callsToday, connectedToday, waToday,
    followupsDueToday, followupsOverdue, readyToClose, needsYou,
    recentActivities, upcoming,
    leadsByTeam, forecastLeads,
    // Team-specific KPIs
    expoMeetingsThisMonth, homeVisitsThisMonth, virtualThisMonth, officeThisMonth, siteVisitsThisMonth,
    coldPromotedToday,
  ] = await Promise.all([
    prisma.lead.count({ where: teamScope }),
    prisma.lead.count({ where: { ...teamScope, status: LeadStatus.NEW } }),
    prisma.lead.count({ where: { ...teamScope, createdAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { ...teamScope, aiScore: AIScore.HOT } }),
    prisma.callLog.count({ where: { ...teamCallWhere, startedAt: { gte: todayStart } } }),
    prisma.callLog.count({ where: { ...teamCallWhere, startedAt: { gte: todayStart }, outcome: CallOutcome.CONNECTED } }),
    prisma.whatsAppMessage.count({ where: { receivedAt: { gte: todayStart } } }),
    prisma.activity.count({ where: { ...teamActWhere, status: ActivityStatus.PLANNED, type: "CALL", scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600 * 1000) } } }),
    prisma.activity.count({ where: { ...teamActWhere, status: ActivityStatus.PLANNED, scheduledAt: { lt: todayStart } } }),
    prisma.lead.count({ where: { ...teamScope, status: { in: [LeadStatus.NEGOTIATION, LeadStatus.SITE_VISIT] } } }),
    prisma.lead.count({ where: { ...teamScope, needsManagerReview: true, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } }),
    prisma.activity.findMany({ where: teamActWhere, orderBy: { createdAt: "desc" }, take: 6, include: { lead: true, user: true } }),
    prisma.activity.findMany({ where: { ...teamActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 5, include: { lead: true } }),
    prisma.lead.groupBy({ by: ["forwardedTeam"], _count: { _all: true } }),
    prisma.lead.findMany({
      where: { ...teamScope, status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] }, budgetMin: { not: null } },
      select: { status: true, budgetMin: true, budgetMax: true, budgetCurrency: true },
    }),
    // Team-specific activity counts (this month)
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.EXPO_MEETING, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.HOME_VISIT, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.VIRTUAL_MEETING, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.OFFICE_MEETING, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.SITE_VISIT, completedAt: { gte: new Date(todayStart.getFullYear(), todayStart.getMonth(), 1) } } }),
    // Cold→Lead conversions today (team-scoped)
    prisma.activity.count({ where: { ...teamActWhere, type: ActivityType.COLD_TO_LEAD, completedAt: { gte: todayStart } } }),
  ]);

  // ── "Today's situation" Command Center hero strip (master spec §9.1) ──
  // Action-first tiles answering: what needs attention RIGHT NOW?
  const sixHoursAgo = new Date(Date.now() - 6 * 3600 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [hotUntouched, overdueFollowups, closableDeals, coldRevivalOps, salesFloorFeed] = await Promise.all([
    prisma.lead.count({
      where: {
        ...teamScope, aiScore: AIScore.HOT,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        OR: [{ lastTouchedAt: { lt: sixHoursAgo } }, { lastTouchedAt: null }],
      },
    }),
    prisma.lead.count({
      where: {
        ...teamScope, followupDate: { lt: new Date(), not: null },
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
      },
    }),
    prisma.lead.count({
      where: { ...teamScope, status: LeadStatus.NEGOTIATION, eoiStage: { not: null } },
    }),
    prisma.lead.count({
      where: {
        ...teamScope, isColdCall: true,
        status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        lastTouchedAt: { lt: thirtyDaysAgo },
        OR: [{ budgetMin: { gt: 5_000_000 } }, { aiScore: AIScore.HOT }],
      },
    }),
    // Sales Floor Live Feed — last 20 team actions (§ 12.2). Each row: agent,
    // verb, lead name, timestamp. Pulled from Activity table (covers CALL,
    // MEETING, SITE_VISIT, COLD_TO_LEAD, NOTE) — already team-scoped.
    prisma.activity.findMany({
      where: { ...teamActWhere, type: { in: [ActivityType.CALL, ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.SITE_VISIT, ActivityType.HOME_VISIT, ActivityType.EXPO_MEETING, ActivityType.COLD_TO_LEAD, ActivityType.LEAD_CREATED, ActivityType.NOTE] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { user: { select: { name: true, avatarColor: true } }, lead: { select: { id: true, name: true } } },
    }),
  ]);

  // Today's mood check-in for THIS user (drives the dashboard card)
  const myMoodToday = await prisma.dailyMood.findUnique({
    where: { userId_date: { userId: me.id, date: todayStart } },
  });

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

  // ── EOI / Booking pipeline alerts (Admin + Manager only) ──
  // Surface the most important counts: how many leads are mid-funnel, how many
  // are waiting on KYC, how many need the viewer's approval, how many are stuck
  // beyond 7 days. Each tile links to /leads?eoi=X for a filtered view.
  let eoiAlerts: { active: number; kycPending: number; approvalNeeded: number; stuck: number } | null = null;
  if (isAdminOrMgr) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [active, kycPending, approvalNeeded, stuck] = await Promise.all([
      prisma.lead.count({ where: { ...teamScope, eoiStage: { not: null } } }),
      prisma.lead.count({ where: { ...teamScope, kycStatus: "PENDING" } }),
      prisma.lead.count({ where: { ...teamScope, eoiApprovalRequired: true } }),
      prisma.lead.count({
        where: {
          ...teamScope,
          bookingDoneAt: null,
          eoiCollectedAt: { lt: sevenDaysAgo, not: null },
        },
      }),
    ]);
    eoiAlerts = { active, kycPending, approvalNeeded, stuck };
  }

  // Forecast computation — weighted by stage
  const forecast = { aed: { closing: 0, meeting: 0, moving: 0, early: 0 }, inr: { closing: 0, meeting: 0, moving: 0, early: 0 } };
  // Live counts per bucket — used for the sub-labels under each card so they
  // reflect reality instead of hard-coded text.
  const fcCounts = { closing: 0, meeting: 0, moving: 0, early: 0 };
  for (const l of forecastLeads) {
    const v = l.budgetMin ?? 0;
    const cur = l.budgetCurrency === "INR" ? "inr" : "aed";
    if (l.status === "NEGOTIATION") { forecast[cur].closing += v * WEIGHTS.NEGOTIATION; fcCounts.closing++; }
    else if (l.status === "SITE_VISIT") { forecast[cur].meeting += v * WEIGHTS.SITE_VISIT; fcCounts.meeting++; }
    else if (l.status === "QUALIFIED") { forecast[cur].moving += v * WEIGHTS.QUALIFIED; fcCounts.moving++; }
    else { forecast[cur].early += v * (l.status === "CONTACTED" ? WEIGHTS.CONTACTED : WEIGHTS.NEW); fcCounts.early++; }
  }
  const fcTotal = (cur: "aed" | "inr") => forecast[cur].closing + forecast[cur].meeting + forecast[cur].moving + forecast[cur].early;
  const fcTotalCount = fcCounts.closing + fcCounts.meeting + fcCounts.moving + fcCounts.early;
  const pluralDeals = (n: number) => `${n} deal${n === 1 ? "" : "s"}`;

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
  const dailyQuote = quoteOfTheDay();
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
    istHour < 17 ? "Good afternoon" :
    istHour < 21 ? "Good evening" : "Working late";
  const energyEmoji =
    istHour < 12 ? "☀️" :
    istHour < 17 ? "⚡" :
    istHour < 21 ? "🌇" : "🌙";

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
          <p className="text-xs sm:text-sm text-gray-500">{new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} · {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} IST · Live data · <span className="text-[10px] text-gray-400">v.{(process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7)}</span></p>
        </div>
        <div className="flex gap-2 flex-wrap items-center self-start sm:self-auto">
          {isAdminOrMgr && (
            <div className="seg">
              <Link href="/dashboard?team=Dubai" className={view === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
              <Link href="/dashboard?team=India" className={view === "India" ? "on" : ""}>🇮🇳 India</Link>
              <Link href="/dashboard?team=all" className={view === "all" ? "on" : ""}>All</Link>
            </div>
          )}
          <Link
            href="/action-list"
            title="Ready-to-close (NEGOTIATION/SITE_VISIT) + Overdue follow-ups + Manager-flagged leads. Scoped to your leads if agent, all leads if manager/admin."
            className="btn btn-gold justify-center"
          >📋 Action List</Link>
        </div>
      </div>

      {/* Welcome strip — greeting + quote always visible at top.
          Per Lalit (Round 5): "Greeting and quote also at top".
          The full Daily Opening card below still has missions/streaks/last-win;
          this is the lightweight always-visible welcome above it. */}
      <div className="card p-3 mb-3 bg-gradient-to-r from-amber-50/40 to-white border-l-4 border-[#c9a24b]">
        <div className="text-sm font-semibold text-[#0b1a33]">
          {energyEmoji} {greeting}, {me.name.split(" ")[0]}
        </div>
        <blockquote className="text-xs italic text-gray-600 mt-1 leading-relaxed">
          💡 {dailyQuote.text}
          <span className="text-[10px] text-gray-500 not-italic"> — {dailyQuote.author}</span>
        </blockquote>
      </div>

      {/* ─── "I am here" widget — Agent T (Round 5) ───
          Per Lalit: "Put I am here at top. so user knows its attendance."
          First card under the page title so the agent sees their check-in
          status the moment the dashboard loads — bigger and more obvious
          than the small AttendanceBadge below. */}
      <IamHereCard
        today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null}
        userId={me.id}
        userName={me.name}
      />

      {/* AI Motivator card — Lalit's brief (Round): "For each agent, there
          should be AI who analyses everything in agent dashboard and
          Motivate him … Each day in morning , A recorded voice should be
          there by Agent which should be like his manager who is motivating
          him." Sits right after I-am-here so the morning order is:
          greeting → attendance → coach → KPIs. The card itself client-fetches
          /api/ai/motivate and (on click) /api/ai/morning-message which it
          plays via the browser's Web Speech API — no server TTS dependency. */}
      <AIMotivatorCard />

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

      {/* ─── Sales Floor Live Feed (§ 12.2) ───
          Real-time view of what the team is doing — gives the floor energy. */}
      {salesFloorFeed.length > 0 && (
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="relative flex h-2 w-2"
              title="Auto-refreshes on every page load. Shows the last 20 calls, meetings, site visits, and notes from your team."
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <div className="font-semibold text-sm">Team activity — live (last 20 actions)</div>
            <span className="text-[10px] text-gray-500">Showing {salesFloorFeed.length}</span>
          </div>
          <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
            {salesFloorFeed.map((a) => {
              const v = activityVisual(a.type);
              return (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <div className={`w-6 h-6 rounded-full ${v.dot} text-white text-[10px] flex items-center justify-center flex-none`}>{v.icon}</div>
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-[#0b1a33]">{a.user?.name ?? "System"}</span>
                    <span className="text-gray-600"> · {v.label.toLowerCase()}</span>
                    {a.lead && <> · <Link href={`/leads/${a.lead.id}`} className="text-[#0b1a33] underline">{a.lead.name}</Link></>}
                  </div>
                  <span className="text-[10px] text-gray-400 flex-none">{formatDistanceToNow(a.createdAt, { addSuffix: true })}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smart suggestions — rule-based daily nudges. Mounted between the
          live Sales Floor feed and the productivity tables so the agent
          immediately sees concrete actions ("which 5 things should I act on
          right now") before the broader stats. Hides itself when every rule
          returns zero. */}
      <SmartSuggestionsCard userId={me.id} role={me.role} team={me.team} />

      {/* Attendance badge — auto-marked on login, shown next to mood */}
      <div className="flex flex-wrap gap-3 items-start">
        <AttendanceBadge today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null} />
      </div>

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
                <div className="text-[11px] text-gray-600 mt-0.5">
                  {todaysMission.reason === "close_eoi" && `In NEGOTIATION · EOI stage: ${todaysMission.eoiStage ?? "—"} · push for booking`}
                  {todaysMission.reason === "hot_untouched" && `HOT score · ${todaysMission.lastTouchedAt ? `last touched ${formatDistanceToNow(todaysMission.lastTouchedAt, { addSuffix: true })}` : "never touched"} — every hour costs you`}
                  {todaysMission.reason === "oldest_overdue" && `Follow-up overdue — win back trust by reaching out today`}
                  {todaysMission.budgetMin && ` · ${fmtMoney(todaysMission.budgetMin, todaysMission.budgetCurrency === "INR" ? "INR" : "AED")}`}
                </div>
              </Link>
            ) : hasMorningWork ? null : (
              <div className="mt-3 rounded-xl border-2 border-dashed border-gray-200 px-4 py-3 text-sm text-gray-600">
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

            <blockquote className="text-[12px] text-gray-700 italic mt-3 border-l-2 border-[#c9a24b] pl-3 leading-relaxed">
              💡 {dailyQuote.text}
              <div className="text-[10px] text-gray-500 not-italic mt-0.5">— {dailyQuote.author}</div>
            </blockquote>

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

      {/* "Your scoreboard" — personal gamification snapshot (level + XP +
          streaks + leaderboard ranks + badges). Mounts immediately after the
          Daily Opening Experience card so the agent sees their standing as
          part of the morning view. */}
      <PersonalScoreboard userId={me.id} />

      {/* §11.5 Daily Missions board — agent-facing gamified daily targets.
          Mounts immediately after the Daily Opening Experience card so the
          morning view flows: greeting + mission CTA → mission progress bars. */}
      <DailyMissionBoard userId={me.id} />

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

      {/* Optional end-of-day mood check-in (renders for all logged-in users) */}
      <MoodCheckIn existing={myMoodToday ? { mood: myMoodToday.mood, comment: myMoodToday.comment } : null} />

      {/* 8 KPI tiles matching your dashboard exactly */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">TODAY AT A GLANCE</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-2 lg:gap-3">
          <KPI title="Calls Dialed Today" value={callsToday} sub="logged across all leads" />
          <KPI title="Calls Connected Today" value={connectedToday} sub={`${connectRate}% connect rate`} />
          <KPI title="Follow-ups Due Today" value={followupsDueToday} sub="scheduled for today" />
          <KPI title="Overdue Follow-ups" value={followupsOverdue} sub="past their follow-up date" />
          <KPI title="Ready to Close" value={readyToClose} sub="showing buying signals" />
          <KPI title="Need Your Attention" value={needsYou} sub="flagged for manager" highlight={needsYou > 0} />
          <KPI title="WhatsApp Touches Today" value={waToday} sub="messages logged" />
          <KPI title="Total Clients" value={totalClients} sub={`${totalNotContacted} not yet contacted`} />
        </div>
      </div>

      {/* Team-specific funnel KPIs (this month) */}
      {view !== "all" && (
        <div>
          <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">
            {view === "Dubai" ? "DUBAI TEAM · THIS MONTH" : "INDIA TEAM · THIS MONTH"}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
            {view === "Dubai" ? (
              <>
                <KPI title="📞 Calls (mo)" value={callsToday} sub="today" />
                <KPI title="💻 Virtual meets" value={virtualThisMonth} sub={monthRangeLabel} />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub={monthRangeLabel} />
                <KPI title="🎪 Expo meets" value={expoMeetingsThisMonth} sub={`${monthRangeLabel} · expos in IN`} />
                <KPI title="🚗 Dubai site visits" value={siteVisitsThisMonth} sub={`${monthRangeLabel} · w/ developer sales`} />
              </>
            ) : (
              <>
                <KPI title="📞 Calls (mo)" value={callsToday} sub="today" />
                <KPI title="🚗 Site visits" value={siteVisitsThisMonth} sub={monthRangeLabel} />
                <KPI title="🏠 Home visits" value={homeVisitsThisMonth} sub={monthRangeLabel} />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub={monthRangeLabel} />
                <KPI title="❄→🔥 Cold→Lead" value={coldPromotedToday} sub="conversions today" highlight={coldPromotedToday > 0} />
              </>
            )}
          </div>
        </div>
      )}

      {/* EOI Pipeline — admin / manager view of the booking funnel. Each tile
          links to /leads?eoi=X for the filtered list. Hidden for agents
          (they see their own funnel on each lead detail page instead). */}
      {eoiAlerts && (
        <div>
          <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">EOI PIPELINE</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:gap-3">
            <Link href="/leads?eoi=active" className="card p-3 lg:p-4 hover:border-[#c9a24b] block">
              <div className="text-2xl lg:text-3xl font-bold">{eoiAlerts.active}</div>
              <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">Active EOI funnel</div>
              <div className="text-[11px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">leads with EOI stage set</div>
            </Link>
            <Link href="/leads?eoi=kyc_pending" className={`card p-3 lg:p-4 hover:border-orange-500 block ${eoiAlerts.kycPending > 0 ? "border-orange-300" : ""}`}>
              <div className="text-2xl lg:text-3xl font-bold">{eoiAlerts.kycPending}</div>
              <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">Waiting on KYC</div>
              <div className="text-[11px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">chase clients for docs</div>
            </Link>
            <Link href="/leads?eoi=approval_needed" className={`card p-3 lg:p-4 hover:border-amber-500 block ${eoiAlerts.approvalNeeded > 0 ? "border-amber-500 border-2 bg-amber-50" : ""}`}>
              <div className="text-2xl lg:text-3xl font-bold">{eoiAlerts.approvalNeeded}</div>
              <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">Need your sign-off</div>
              <div className="text-[11px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">discount / waiver approval</div>
            </Link>
            <Link href="/leads?eoi=stuck" className={`card p-3 lg:p-4 hover:border-red-500 block ${eoiAlerts.stuck > 0 ? "border-red-300" : ""}`}>
              <div className="text-2xl lg:text-3xl font-bold">{eoiAlerts.stuck}</div>
              <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">Stuck deals</div>
              <div className="text-[11px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">EOI collected 7+ days, no booking</div>
            </Link>
          </div>
        </div>
      )}

      {/* Weighted Sales Forecast */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">SALES FORECAST (WEIGHTED)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <ForecastCard label="EXPECTED THIS MONTH" sub={`${pluralDeals(fcCounts.closing)} at closing stage`} aed={forecast.aed.closing} inr={forecast.inr.closing} color="border-emerald-500" />
          <ForecastCard label="EXPECTED IN 1-3 MONTHS" sub={`${pluralDeals(fcCounts.meeting + fcCounts.moving)} actively moving`} aed={forecast.aed.meeting + forecast.aed.moving} inr={forecast.inr.meeting + forecast.inr.moving} color="border-amber-500" />
          <ForecastCard label="LONGER-TERM POTENTIAL" sub={`${pluralDeals(fcCounts.early)} early / cold`} aed={forecast.aed.early} inr={forecast.inr.early} color="border-blue-500" />
          <ForecastCard label="TOTAL WEIGHTED FORECAST" sub={`${pluralDeals(fcTotalCount)} across all stages`} aed={fcTotal("aed")} inr={fcTotal("inr")} color="border-[#c9a24b]" />
        </div>
        <p className="text-xs text-gray-500 mt-2">Each deal is weighted by likelihood: closing 55%, meeting 30%, actively moving 10%, early/cold 2%. Adjust in <code>WEIGHTS</code> if needed.</p>
      </div>

      {/* By Salesperson table — ADMIN/MANAGER only (team-wide competitive data) */}
      {isAdminOrMgr && (
      <div className="card p-3 lg:p-5 overflow-x-auto">
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-3">BY SALESPERSON</div>
        <table className="tbl w-full min-w-[520px]">
          <thead><tr>
            <th>Salesperson</th><th>Team</th><th className="text-center">Calls Today</th><th className="text-center">Connected</th><th className="text-center">Due Today</th><th className="text-center">Overdue</th><th className="text-center">Closeable</th><th className="text-center">Needs Lalit</th><th className="text-center">Clients</th>
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

      {/* Charts — Leads-over-time chart removed per Lalit's "remove leads
          over time from dashboard". The daily intake number is already in
          the KPI tile row above so the chart was redundant. */}

      {/* Recent activity + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="font-semibold mb-3">Recent activity</div>
          <div className="space-y-3">
            {recentActivities.map((a) => {
              const v = activityVisual(a.type);
              return (
                <div key={a.id} className="flex gap-3 items-start">
                  <div className={`w-7 h-7 rounded-full ${v.dot} text-white flex items-center justify-center text-xs flex-none shadow-sm`}>{v.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">
                      <b>{a.user?.name ?? "System"}</b> · {a.title}
                      {a.lead && <> on <Link href={`/leads/${a.lead.id}`} className="text-[#0b1a33] font-semibold hover:underline">{a.lead.name}</Link></>}
                    </div>
                    <div className="text-xs text-gray-500">{v.label} · {formatDistanceToNow(a.createdAt, { addSuffix: true })}</div>
                  </div>
                </div>
              );
            })}
            {recentActivities.length === 0 && <div className="text-sm text-gray-500">No activity yet.</div>}
          </div>
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Upcoming follow-ups</div>
          <div className="space-y-2">
            {upcoming.map((a) => (
              <Link key={a.id} href={a.lead ? `/leads/${a.lead.id}` : "#"} className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb] hover:border-[#c9a24b]">
                <div>
                  <div className="text-sm font-semibold">{a.title}{a.lead && ` · ${a.lead.name}`}</div>
                  <div className="text-xs text-gray-500">{a.scheduledAt && `${fmtIST12(a.scheduledAt)} IST`}</div>
                </div>
                <span className="chip chip-new">{a.type}</span>
              </Link>
            ))}
            {upcoming.length === 0 && <div className="text-sm text-gray-500">Nothing scheduled.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

function KPI({ title, value, sub, highlight }: { title: string; value: number; sub: string; highlight?: boolean }) {
  return (
    <div className={`card p-3 lg:p-4 ${highlight ? "border-amber-500 border-2 bg-amber-50" : ""}`}>
      <div className="text-2xl lg:text-3xl font-bold">{value}</div>
      <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">{title}</div>
      <div className="text-[11px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">{sub}</div>
    </div>
  );
}
function ForecastCard({ label, sub, aed, inr, color }: { label: string; sub: string; aed: number; inr: number; color: string }) {
  return (
    <div className={`card p-3 border-l-4 ${color}`}>
      <div className="text-[10px] tracking-widest text-gray-500 uppercase">{label}</div>
      <div className="text-base font-bold mt-1 leading-tight">
        {aed > 0 && <div>{fmtMoney(aed, "AED")}</div>}
        {inr > 0 && <div>{fmtMoney(inr, "INR")}</div>}
        {aed === 0 && inr === 0 && <div className="text-gray-400">—</div>}
      </div>
      <div className="text-[11px] text-gray-500 mt-1">{sub}</div>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { LeadStatus, LeadSource, AIScore, CallOutcome, ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { fmtIST12 } from "@/lib/datetime";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import { runReconciler } from "@/lib/reconciler";
import { getTestingModeEnabled } from "@/lib/settings";
import { activityVisual } from "@/lib/activityIcon";
import { requireUser } from "@/lib/auth";
import Link from "next/link";
import MoodCheckIn from "@/components/MoodCheckIn";
import AttendanceBadge from "@/components/AttendanceBadge";
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
    leadsBySource, recentActivities, upcoming, _sourceMix,
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
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, where: { ...teamScope, createdAt: { gte: todayStart } } }),
    prisma.activity.findMany({ where: teamActWhere, orderBy: { createdAt: "desc" }, take: 6, include: { lead: true, user: true } }),
    prisma.activity.findMany({ where: { ...teamActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 5, include: { lead: true } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, where: teamScope }),
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
  const spStatsRaw = await prisma.$queryRaw<SpRow[]>`
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
  `;
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
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [myNewOvernight, myFollowupsToday, myCallbacksToday] = await Promise.all([
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
  ]);
  const dailyQuote = quoteOfTheDay();
  const hasMorningWork = myNewOvernight > 0 || myFollowupsToday > 0 || myCallbacksToday > 0;

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
          <Link href="/action-list" className="btn btn-gold justify-center">📋 Action List</Link>
        </div>
      </div>

      {/* Attendance badge — auto-marked on login, shown next to mood */}
      <div className="flex flex-wrap gap-3 items-start">
        <AttendanceBadge today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null} />
      </div>

      {/* Morning briefing — per-agent "your day at a glance". Always visible (not
          just on a single cron tick) so agents logging in at 10am or any time
          after can see what landed overnight + what they have today. */}
      <div className="card p-4 border-l-4 border-[#c9a24b] bg-amber-50/30">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-xs tracking-widest text-gray-500 uppercase">🌅 Your day, {me.name.split(" ")[0]}</div>
            {hasMorningWork ? (
              <div className="flex flex-wrap gap-2 mt-2 text-sm">
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
            ) : (
              <div className="text-sm text-gray-600 mt-1.5">All clear — no new leads or callbacks today.</div>
            )}
            <blockquote className="text-[12px] text-gray-700 italic mt-3 border-l-2 border-[#c9a24b] pl-3 leading-relaxed">
              💡 {dailyQuote.text}
              <div className="text-[10px] text-gray-500 not-italic mt-0.5">— {dailyQuote.author}</div>
            </blockquote>
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
                <KPI title="💻 Virtual meets" value={virtualThisMonth} sub="this month" />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub="this month" />
                <KPI title="🎪 Expo meets" value={expoMeetingsThisMonth} sub="developer expos in IN" />
                <KPI title="🚗 Dubai site visits" value={siteVisitsThisMonth} sub="with developer's sales" />
              </>
            ) : (
              <>
                <KPI title="📞 Calls (mo)" value={callsToday} sub="today" />
                <KPI title="🚗 Site visits" value={siteVisitsThisMonth} sub="this month" />
                <KPI title="🏠 Home visits" value={homeVisitsThisMonth} sub="this month" />
                <KPI title="🏢 Office meets" value={officeThisMonth} sub="this month" />
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

      {/* By Salesperson table */}
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

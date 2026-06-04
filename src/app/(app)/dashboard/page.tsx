import { prisma } from "@/lib/prisma";
import { LeadStatus, AIScore, CallOutcome, ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { fmtIST12 } from "@/lib/datetime";
import { runReconciler } from "@/lib/reconciler";
import { getTestingModeEnabled } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import IamHereCard from "@/components/IamHereCard";
import { todayIST } from "@/lib/attendance";
import { normalizeTeam } from "@/lib/teamRouting";

export const dynamic = "force-dynamic";


export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  runReconciler().catch(() => {});
  const todayStart = startOfDay(new Date());

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

  // IST offset (UTC+5:30) — used throughout this page
  const istOffset = 5.5 * 60 * 60 * 1000;

  // ── Global date-range filter (?from=YYYY-MM-DD&to=YYYY-MM-DD) ─────────
  // Dashboard defaults to IST today when no date params are present.
  // Server redirect sets from=today&to=today, preserving any ?team= param.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rawFrom = sp.from && DATE_RE.test(sp.from) ? sp.from : null;
  const rawTo   = sp.to   && DATE_RE.test(sp.to)   ? sp.to   : null;

  if (!rawFrom || !rawTo) {
    const todayIso = new Date(Date.now() + istOffset).toISOString().slice(0, 10);
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (v && k !== "from" && k !== "to") p.set(k, v);
    }
    p.set("from", todayIso);
    p.set("to", todayIso);
    redirect(`/dashboard?${p.toString()}`);
  }

  // rawFrom & rawTo are non-null after redirect
  function istMidnightUTC(dateStr: string): Date {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) - istOffset);
  }
  const sqlFrom = istMidnightUTC(rawFrom);
  const sqlTo   = new Date(istMidnightUTC(rawTo).getTime() + 86400000);

  // Section labels
  const todayIsoStr = new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const fmt2 = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  };
  const isToday     = rawFrom === rawTo && rawFrom === todayIsoStr;
  const isSingleDay = rawFrom === rawTo;
  const periodSection: string = isToday
    ? "TODAY"
    : isSingleDay ? fmt2(rawFrom).toUpperCase()
    : `${fmt2(rawFrom)} – ${fmt2(rawTo)}`;

  const [
    followupsDueToday,
    upcoming,
    todayCallsCount,
    // TODAY section — scheduled activity counts for the selected period
    leadFollowupsDueToday, meetingsToday, siteVisitsToday, virtualMeetingsToday,
  ] = await Promise.all([
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: "CALL", scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.activity.findMany({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: sqlTo } }, orderBy: { scheduledAt: "asc" }, take: 8, include: { lead: { select: { id: true, name: true } } } }), // B-15: only lead.id/name rendered — UPCOMING: after selected period
    // Calls by this user in the selected period — feeds KPI tiles
    prisma.callLog.count({
      where: {
        userId: me.id,
        startedAt: { gte: sqlFrom, lt: sqlTo },
      },
    }),
    // TODAY section — lead follow-up dates and scheduled activity counts for the selected period
    prisma.lead.count({ where: { ...meScope, followupDate: { gte: sqlFrom, lt: sqlTo }, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: { in: [ActivityType.EXPO_MEETING, ActivityType.OFFICE_MEETING, ActivityType.HOME_VISIT] }, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: ActivityType.SITE_VISIT, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: ActivityType.VIRTUAL_MEETING, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
  ]);

  // UPCOMING counts — activities/follow-ups scheduled after the selected period ends
  const [upcomingFollowupsCount, upcomingActivitiesCount] = await Promise.all([
    prisma.lead.count({ where: { ...meScope, followupDate: { gte: sqlTo }, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: sqlTo } } }),
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

  // ── Team scoreboard — calls made today by each agent ──────────────────
  // Only fetched for ADMIN / MANAGER (competitive data, not for agents).
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team ?? "") : null;

  // ⚡ PERFORMANCE: was 30 sequential queries (5 per agent × 6 agents). Now 1.
  type SpRow = { id: string; name: string; team: string | null; calls: bigint; connected: bigint; due_today: bigint; overdue: bigint; closeable: bigint; needs: bigint; clients: bigint };
  // ADMIN/MANAGER only — this table exposes every teammate's call counts,
  // pipeline & client totals (competitive data). Agents see their own numbers
  // in the KPI tiles + briefing above; the cross-team breakdown is management-
  // only. Skipping the query for agents also avoids 9 sub-selects × N users.
  // Calls / due_today use the selected period; overdue/closeable/needs are state-based.
  const spStatsRaw: SpRow[] = isAdminOrMgr ? await prisma.$queryRaw<SpRow[]>`
    SELECT u.id, u.name, u.team,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${sqlFrom} AND c."startedAt" < ${sqlTo}), 0) as calls,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${sqlFrom} AND c."startedAt" < ${sqlTo} AND c.outcome::text = 'CONNECTED'), 0) as connected,
      COALESCE((SELECT COUNT(*) FROM "Activity" a WHERE a."userId" = u.id AND a.status::text = 'PLANNED' AND a."scheduledAt" >= ${sqlFrom} AND a."scheduledAt" < ${sqlTo}), 0) as due_today,
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

  // Daily targets — read from Setting table, fall back to defaults
  const targetRow = await prisma.setting.findUnique({ where: { key: "dailyTargets" } });
  const T = { calls: 150, connected: 50, virtual: 2, f2f: 1, fresh: 5, deals: 5 };
  const targets = targetRow ? { ...T, ...JSON.parse(targetRow.value) } : T;

  // Personal KPI metrics — always userId: me.id (agents AND admin/manager see their OWN numbers)
  const [connectedPersonal, virtualPersonal, f2fPersonal, freshPersonal, dealsPersonal] = await Promise.all([
    prisma.callLog.count({ where: { userId: me.id, startedAt: { gte: sqlFrom, lt: sqlTo }, outcome: CallOutcome.CONNECTED } }),
    prisma.activity.count({ where: { userId: me.id, type: ActivityType.VIRTUAL_MEETING, scheduledAt: { gte: sqlFrom, lt: sqlTo }, status: { not: ActivityStatus.CANCELLED } } }),
    prisma.activity.count({ where: { userId: me.id, type: { in: [ActivityType.SITE_VISIT, ActivityType.HOME_VISIT, ActivityType.OFFICE_MEETING, ActivityType.EXPO_MEETING] }, scheduledAt: { gte: sqlFrom, lt: sqlTo }, status: { not: ActivityStatus.CANCELLED } } }),
    prisma.activity.count({ where: { userId: me.id, type: ActivityType.COLD_TO_LEAD, completedAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.lead.count({ where: { ownerId: me.id, status: LeadStatus.WON, updatedAt: { gte: sqlFrom, lt: sqlTo } } }),
  ]);

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
  const hasMorningWork = myNewOvernight > 0 || myFollowupsToday > 0 || myCallbacksToday > 0;

  // Time-aware greeting — uses IST hour to pick morning/afternoon/evening.
  const istNow = new Date(Date.now() + 5.5 * 3600_000);
  const istHour = istNow.getUTCHours();
  const greeting =
    istHour < 12 ? "Good morning" :
    istHour < 17 ? "Good afternoon" : "Good evening";
  const energyEmoji =
    istHour < 12 ? "☀️" :
    istHour < 17 ? "⚡" : "🌇";

  return (
    <>
      {testingModeOn && me.role !== "AGENT" && (
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
          <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>
          {me.role !== "AGENT" && (
            <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
              {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })} · {new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })} IST
            </p>
          )}
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
      {me.role !== "AGENT" && (
        <IamHereCard
          today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null}
          userId={me.id}
          userName={me.name}
        />
      )}


      {/* ── SECTION 1: TODAY ─────────────────────────────────────────────
          Q1: What needs attention right now? + What is planned today?
          Row 1 = urgent (state-based, always current).
          Row 2 = scheduled for the selected period. */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2 uppercase">
          📅 TODAY — {periodSection}
        </div>
        {/* Urgent — state-based, always "right now" */}
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
        {/* Scheduled — period-based, what is planned for the selected day/range */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
          <Link href="/activities?type=CALL" className="card p-4 hover:shadow-lg transition">
            <div className="text-3xl font-extrabold text-indigo-700 dark:text-indigo-300">{followupsDueToday}</div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">📞 Calls due</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">scheduled · {periodSection.toLowerCase()}</div>
          </Link>
          <Link href="/leads?followup=today" className="card p-4 hover:shadow-lg transition">
            <div className="text-3xl font-extrabold text-amber-700 dark:text-amber-300">{leadFollowupsDueToday}</div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">📅 Follow-ups due</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">lead follow-up date · {periodSection.toLowerCase()}</div>
          </Link>
          <Link href="/activities?type=MEETING" className="card p-4 hover:shadow-lg transition">
            <div className="text-3xl font-extrabold text-teal-700 dark:text-teal-300">{meetingsToday}</div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">🤝 Meetings</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">expo / office / home · {periodSection.toLowerCase()}</div>
          </Link>
          <Link href="/activities?type=SITE_VISIT" className="card p-4 hover:shadow-lg transition">
            <div className="text-3xl font-extrabold text-green-700 dark:text-green-300">{siteVisitsToday}</div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">🏗️ Site visits</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">scheduled · {periodSection.toLowerCase()}</div>
          </Link>
          <Link href="/activities?type=VIRTUAL_MEETING" className="card p-4 hover:shadow-lg transition">
            <div className="text-3xl font-extrabold text-sky-700 dark:text-sky-300">{virtualMeetingsToday}</div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">💻 Virtual meets</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">scheduled · {periodSection.toLowerCase()}</div>
          </Link>
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

      {/* §12.4 Daily Opening Experience
          Premium morning greeting + single "today's mission" CTA + streak
          nudge + the existing chips + the daily quote. Always visible. */}
      <div className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/60 to-white">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-[#0b1a33]">
                {energyEmoji} {greeting}, {me.name.split(" ")[0]}
              </h2>
            </div>

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

          </div>
        </div>
      </div>

      {/* ── SECTION 2: UPCOMING ────────────────────────────────────────────
          Q2: What is coming next after the selected period? */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="font-semibold">📆 Future Activities</div>
          <div className="flex gap-2 text-xs flex-wrap">
            {upcomingFollowupsCount > 0 && (
              <Link href="/leads?followup=upcoming" className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-semibold hover:bg-amber-200">
                {upcomingFollowupsCount} follow-up{upcomingFollowupsCount === 1 ? "" : "s"}
              </Link>
            )}
            {upcomingActivitiesCount > 0 && (
              <Link href="/activities" className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300 font-semibold hover:bg-blue-200">
                {upcomingActivitiesCount} activit{upcomingActivitiesCount === 1 ? "y" : "ies"}
              </Link>
            )}
          </div>
        </div>
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
          {upcoming.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">Nothing scheduled ahead.</div>}
        </div>
      </div>

      {/* ── DAILY PERFORMANCE ────────────────────────────────── */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2 uppercase">
          📊 Daily Performance · {periodSection}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-2 lg:gap-3">
          <KpiTarget label="Total Calls" achieved={todayCallsCount} target={targets.calls} />
          <KpiTarget label="Connected Calls" achieved={connectedPersonal} target={targets.connected} />
          <KpiTarget label="Virtual Meetings" achieved={virtualPersonal} target={targets.virtual} />
          <KpiTarget label="Site Visits (F2F)" achieved={f2fPersonal} target={targets.f2f} />
          <KpiTarget label="Fresh Clients" achieved={freshPersonal} target={targets.fresh} />
          <KpiTarget label="Deals Closed" achieved={dealsPersonal} target={targets.deals} />
        </div>
      </div>

      {/* By Salesperson table — ADMIN/MANAGER only (team-wide competitive data) */}
      {isAdminOrMgr && (
      <div className="card p-3 lg:p-5 overflow-x-auto">
        <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-3">BY SALESPERSON · TEAM · {periodSection}</div>
        <table className="tbl w-full min-w-[520px]">
          <thead><tr>
            <th>Salesperson</th><th>Team</th><th className="text-center">Calls</th><th className="text-center">Connected</th><th className="text-center">Due</th><th className="text-center">Overdue now</th><th className="text-center">Closeable now</th><th className="text-center">Needs {me.name.split(" ")[0]}</th><th className="text-center">Clients (total)</th>
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
    </>
  );
}

function KpiTarget({ label, achieved, target }: { label: string; achieved: number; target: number }) {
  const pending = Math.max(0, target - achieved);
  const done = target > 0 && achieved >= target;
  return (
    <div className={`card p-3 lg:p-4 ${done ? "border-emerald-500 border-2 bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
      <div className="text-[10px] lg:text-[11px] tracking-widest text-gray-500 dark:text-slate-400 uppercase font-bold mb-2 leading-tight">{label}</div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">Target</span>
          <span className="font-semibold text-gray-600 dark:text-slate-300">{target}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">Achieved</span>
          <span className={`font-bold text-base ${done ? "text-emerald-600 dark:text-emerald-400" : "text-[#0b1a33] dark:text-white"}`}>{achieved}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[11px] text-gray-500 dark:text-slate-400">Pending</span>
          <span className={`font-bold text-base ${pending === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{pending}</span>
        </div>
        {target > 0 && (
          <div className="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-1 mt-1">
            <div className={`h-1 rounded-full transition-all ${done ? "bg-emerald-500" : "bg-[#c9a24b]"}`}
              style={{ width: `${Math.min(100, Math.round((achieved / target) * 100))}%` }} />
          </div>
        )}
      </div>
    </div>
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

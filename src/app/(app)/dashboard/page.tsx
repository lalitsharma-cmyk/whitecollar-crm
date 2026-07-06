import { prisma } from "@/lib/prisma";
import { AIScore, CallOutcome, ActivityStatus, ActivityType, Prisma } from "@prisma/client";
import { SUPPRESSED_STATUSES, CLOSING_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";
import { COLD_ORIGINS, workableWhere, activeBoardWhere } from "@/lib/leadScope";
import { formatDistanceToNow, startOfDay } from "date-fns";
import { fmtIST12 } from "@/lib/datetime";
import { dashboardQuoteOfTheDay, istDayNumber } from "@/lib/salesQuotes";
import { runReconciler } from "@/lib/reconciler";
import { getTestingModeEnabled } from "@/lib/settings";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import IamHereCard from "@/components/IamHereCard";
import AgentStatusBar from "@/components/AgentStatusBar";
import { todaysEvents, openGoingEvent, todaysHereEvent } from "@/lib/agentStatus";
import { todayIST } from "@/lib/attendance";
import { normalizeTeam } from "@/lib/teamRouting";
import { formatLeadName } from "@/lib/leadName";
import TargetCelebration from "@/components/TargetCelebration";
import RemindersCard, { type ReminderEvent } from "@/components/RemindersCard";
import { countUnassignedLeads, countAwaitingTeamLeads } from "@/lib/leadCounts";
import { hotUntouchedWhere, buyerCallsCount, buyerConnectedCallsCount } from "@/lib/dashboardWidgets";
import { freshUntouchedWhere } from "@/lib/freshLeads";
import DashboardAssignmentWidget from "@/components/DashboardAssignmentWidget";
import DashboardGreeting from "@/components/DashboardGreeting";
import { tzForTeam, greetingFor, overdueFollowupBoundary } from "@/lib/datetime";
import DashboardBroadcastInbox from "@/components/DashboardBroadcastInbox";
import DashboardVoiceBroadcast from "@/components/DashboardVoiceBroadcast";
import { canSendBroadcast, broadcastRecipientWhere, broadcastAudienceLabel } from "@/lib/voiceBroadcast";
import HelpDot from "@/components/HelpDot";

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
  // Lead-Ops / Support-Admin (Sameer): a lead-distribution manager, NOT a sales
  // agent. Hide every personal-performance card; show the management queue instead.
  // Keyed off the per-user flag — NOT role (Lalit is ADMIN but not lead-ops).
  const isLeadOps = (me as { leadOpsOnly?: boolean }).leadOpsOnly === true;
  const isAdmin = me.role === "ADMIN";
  // Assignment-queue counts: Sameer (lead-ops) gets the full management view that
  // REPLACES personal KPIs; Lalit/admins get a compact card ADDED above their
  // personal dashboard. Either way the same counts are computed once here.
  // Using unified leadCounts module for consistency with Master Data.
  const mgmt = (isLeadOps || isAdmin) ? await (async () => {
    const w = workableWhere({ deletedAt: null, isColdCall: false });
    const [unassigned, awaitingTeam] = await Promise.all([
      countUnassignedLeads(),
      countAwaitingTeamLeads(),
    ]);
    const overdueUnassigned = await prisma.lead.count({
      where: { ...w, ownerId: null, rejectedAt: null, followupDate: { lt: overdueFollowupBoundary(), not: null } }
    });
    return { unassigned, overdueUnassigned, awaitingTeam };
  })() : null;
  const view =
    me.role === "ADMIN"
      ? (sp.team === "India" ? "India" : sp.team === "Dubai" ? "Dubai" : sp.team === "all" ? "all" : (me.team === "India" ? "India" : me.team === "Dubai" ? "Dubai" : "all"))
      : (me.team === "India" ? "India" : "Dubai"); // MANAGER + AGENT locked to own team

  // Team param threaded onto the meetings/site-visit/virtual drill hrefs so the
  // /activities "Scheduled Today" list reproduces the tile's team-scoped where.
  // Only meaningful for ADMIN/MANAGER (their tiles count `teamActWhere`, which is
  // team-filtered); AGENT tiles count by userId so the drill ignores ?view= for
  // them — we omit it to keep the agent URL clean. "all" needs no team filter.
  // (isAdminOrMgr is defined above.)
  const tileViewParam = isAdminOrMgr && (view === "India" || view === "Dubai") ? `&view=${view}` : "";

  // Soft-deleted leads (recycle bin) must NEVER count in any active dashboard
  // figure, so deletedAt:null is baked into every scope here — and into the
  // `lead:` relation filter for activity/call queries. Every count below spreads
  // one of these, so this single place keeps deleted leads out of the whole page.
  const teamScope: Prisma.LeadWhereInput = view === "all" ? { deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } } : { forwardedTeam: view, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } };
  const teamActWhere: Prisma.ActivityWhereInput = view === "all" ? { lead: { deletedAt: null } } : { lead: { forwardedTeam: view, deletedAt: null } };
  const teamCallWhere: Prisma.CallLogWhereInput = view === "all" ? { lead: { deletedAt: null } } : { lead: { forwardedTeam: view, deletedAt: null } };

  // ── Personal scope (audit B-03 / P1-4) ─────────────────────────────
  // An AGENT's KPI hero tiles must count THEIR OWN book — otherwise "Total
  // clients / Calls today / Ready to close / follow-ups" silently include
  // teammates' work and overstate the agent's numbers. ADMIN/MANAGER keep the
  // team view (their dashboard is a leadership console), so for them meScope
  // === teamScope and the dashboard is byte-for-byte unchanged. BY DESIGN these
  // stay team-wide for everyone: the team-distribution chart (leadsByTeam) and
  // the explicitly-labelled "TEAM · THIS MONTH" funnel counts.
  const meScope: Prisma.LeadWhereInput = isAdminOrMgr ? teamScope : { ownerId: me.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } };
  const meActWhere: Prisma.ActivityWhereInput = isAdminOrMgr ? teamActWhere : { userId: me.id, lead: { deletedAt: null } };
  const meCallWhere: Prisma.CallLogWhereInput = isAdminOrMgr ? teamCallWhere : { userId: me.id, lead: { deletedAt: null } };
  // Cold-revival scope — the SAME team/owner envelope as meScope but WITHOUT the
  // `leadOrigin notIn COLD_ORIGINS` exclusion, so the "Cold revival" tile can
  // actually count cold/revival leads (meScope + isColdCall was mutually exclusive
  // → always ~0). Audit fix 2026-06-27.
  const coldScope: Prisma.LeadWhereInput = isAdminOrMgr
    ? (view === "all" ? { deletedAt: null } : { forwardedTeam: view, deletedAt: null })
    : { ownerId: me.id, deletedAt: null };

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
    upcoming,
    todayCallsCount,
    // TODAY section — only meetings/site visits/virtual meets shown
    meetingsToday, siteVisitsToday, virtualMeetingsToday,
  ] = await Promise.all([
    prisma.activity.findMany({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: sqlTo } }, orderBy: { scheduledAt: "asc" }, take: 8, include: { lead: { select: { id: true, name: true } } } }), // B-15: only lead.id/name rendered — UPCOMING: after selected period
    // Calls by this user in the selected period — feeds the "Total Calls" KPI.
    // CallLog side counts LEAD calls (deletedAt:null) + UNLINKED calls, but
    // EXCLUDES buyer-linked rows (buyerId:null) — buyer calls are counted once from
    // the BuyerActivity ledger below (a telephony buyer call writes BOTH a
    // CallLog{buyerId} and a BuyerActivity CALL, so sourcing buyers from one place
    // avoids double-counting). unlinked = leadId null AND buyerId null.
    prisma.callLog.count({
      where: {
        userId: me.id,
        startedAt: { gte: sqlFrom, lt: sqlTo },
        buyerId: null,
        OR: [{ lead: { deletedAt: null } }, { leadId: null }],
      },
    }),
    // TODAY section — scheduled activity counts for the selected period
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: { in: [ActivityType.EXPO_MEETING, ActivityType.OFFICE_MEETING, ActivityType.HOME_VISIT] }, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: ActivityType.SITE_VISIT, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, type: ActivityType.VIRTUAL_MEETING, scheduledAt: { gte: sqlFrom, lt: sqlTo } } }),
  ]);

  // UPCOMING counts — activities/follow-ups scheduled after the selected period ends.
  // Follow-ups count through activeBoardWhere (the SAME Active-Board envelope the
  // Action List + Leads "Future" chip use) so the three surfaces reconcile.
  const [upcomingFollowupsCount, upcomingActivitiesCount] = await Promise.all([
    prisma.lead.count({ where: { ...activeBoardWhere(meScope), followupDate: { gte: sqlTo } } }),
    prisma.activity.count({ where: { ...meActWhere, status: ActivityStatus.PLANNED, scheduledAt: { gte: sqlTo } } }),
  ]);

  // ── "Today's situation" Command Center hero strip (master spec §9.1) ──
  // Action-first tiles answering: what needs attention RIGHT NOW?
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  // ── HERO "needs attention RIGHT NOW" counts — count == drill (single source) ──
  // Each count below uses a CANONICAL where that the card's /leads href reproduces
  // exactly, so the number shown == the rows that open on click == a direct DB
  // count. Personal for an agent (own book via meScope); team-wide for leadership.
  //   • Hot Untouched   → hotUntouchedWhere(): HOT + workable + UNTOUCHED (no
  //                       contact/meeting/site-visit logged). Drill: /leads?ai=HOT
  //                       &untouched=1&followup=all (+ seg=mine for admin).
  //   • Overdue         → Active Board + followupDate in the past. Drill: ?followup=overdue.
  //                       Counts through activeBoardWhere — the SAME envelope the
  //                       Action List + Leads "Overdue" chip use (terminal excluded;
  //                       Master-Data only when assigned+scheduled) — so the
  //                       Action-List ⇄ Leads-chip ⇄ Dashboard reconciliation holds.
  //   • Meeting / Visit Stage → workable + status in CLOSING_STATUSES (meeting/visit/
  //     office/zoom/expo). These are ACTIVE leads near closing — NOT closed/won.
  //     Drill: ?smart=visit_potential.
  //   • Cold revival    → cold pool (isColdCall), high-value dormant — drills to
  //                       /cold-calls (its OWN scope), so its count mirrors that page.
  const [hotUntouched, overdueFollowups, closableDeals, coldRevivalOps, freshUntouchedTodayCount] = await Promise.all([
    prisma.lead.count({ where: hotUntouchedWhere(meScope) }),
    prisma.lead.count({
      // Overdue = before start of today IST (canonical) so this tile's count
      // matches its ?followup=overdue drill on Leads + the Action List.
      where: { ...activeBoardWhere(meScope), followupDate: { lt: overdueFollowupBoundary(), not: null } },
    }),
    // Closable = workable leads at a closing stage (meeting / visit / dubai / EOI
    // stages). Reconciles with /leads?smart=visit_potential (currentStatus IN
    // CLOSING_STATUSES, workable). Dropped the eoiStage gate so the count matches
    // the drill (the smart chip has no eoiStage condition).
    prisma.lead.count({
      where: { ...workableWhere(meScope), currentStatus: { in: CLOSING_STATUSES } },
    }),
    prisma.lead.count({
      where: {
        ...coldScope,
        currentStatus: { notIn: SUPPRESSED_STATUSES },
        lastTouchedAt: { lt: thirtyDaysAgo },
        // cold/revival origin AND (hot budget OR HOT score) — two ORs combined via
        // AND so neither key overwrites the other.
        AND: [
          { OR: [{ leadOrigin: { in: COLD_ORIGINS } }, { isColdCall: true }] },
          { OR: [{ budgetMin: { gt: 5_000_000 } }, { aiScore: AIScore.HOT }] },
        ],
      },
    }),
    // Fresh untouched today — assigned today, no first contact yet (single source
    // of truth: freshLeads.ts). count == drill (/leads?fresh=untouched).
    prisma.lead.count({ where: freshUntouchedWhere(meScope) }),
  ]);

  // Today's attendance for THIS user
  const myAttendanceToday = await prisma.attendance.findUnique({
    where: { userId_date: { userId: me.id, date: todayIST() } },
  });

  // ── Field-movement status widget data (this user's own events) ──
  const [myStatusEventsRaw, myOpenGoingRaw, myHereTodayRaw] = await Promise.all([
    todaysEvents(me.id),
    openGoingEvent(me.id),
    todaysHereEvent(me.id),
  ]);
  const myStatusEvents = myStatusEventsRaw.map((e) => ({
    id: e.id,
    status: e.status,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    durationMin: e.durationMin,
    pairedEventId: e.pairedEventId,
  }));
  const myOpenGoing = myOpenGoingRaw
    ? {
        id: myOpenGoingRaw.id,
        status: myOpenGoingRaw.status,
        startedAt: myOpenGoingRaw.startedAt.toISOString(),
        endedAt: myOpenGoingRaw.endedAt ? myOpenGoingRaw.endedAt.toISOString() : null,
        durationMin: myOpenGoingRaw.durationMin,
        pairedEventId: myOpenGoingRaw.pairedEventId,
      }
    : null;
  // "I Am Here" locks once marked for the IST day — true if the attendance
  // self-check-in OR a HERE field-status event already exists today.
  const myCheckedInToday = !!myAttendanceToday?.selfCheckedInAt || myHereTodayRaw != null;

  // ADMIN-only morning-window widget: overnight leads waiting for assign
  let morningQueueCount = 0;
  let morningQueueLeads: Array<{ id: string; name: string; phone: string | null; createdAt: Date; forwardedTeam: string | null }> = [];
  if (me.role === "ADMIN") {
    // Created after 10pm yesterday IST AND still unassigned today
    const cutoff = new Date(Date.now() - 14 * 3600 * 1000); // last 14 hours
    morningQueueLeads = await prisma.lead.findMany({
      // rejectedAt: null — a rejected lead is unassigned for HISTORY only; it must
      // never appear in the "waiting for your assign" queue (Lalit 2026-06-28).
      where: { ownerId: null, isColdCall: false, deletedAt: null, rejectedAt: null, createdAt: { gte: cutoff }, currentStatus: { notIn: SUPPRESSED_STATUSES } },
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
  // hrOnly = false EXCLUDES HR/non-sales users (e.g. Nisha, an hrOnly MANAGER) so
  // the SALES performance board only ever shows actual sales agents — mirrors the
  // agentPerformance.ts roster (hrOnly:false) used by the Live-Assignment widget.
  const spStatsRaw: SpRow[] = isAdminOrMgr ? await prisma.$queryRaw<SpRow[]>`
    SELECT u.id, u.name, u.team,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${sqlFrom} AND c."startedAt" < ${sqlTo}), 0) as calls,
      COALESCE((SELECT COUNT(*) FROM "CallLog" c WHERE c."userId" = u.id AND c."startedAt" >= ${sqlFrom} AND c."startedAt" < ${sqlTo} AND c.outcome::text = 'CONNECTED'), 0) as connected,
      COALESCE((SELECT COUNT(*) FROM "Activity" a WHERE a."userId" = u.id AND a.status::text = 'PLANNED' AND a."scheduledAt" >= ${sqlFrom} AND a."scheduledAt" < ${sqlTo}), 0) as due_today,
      COALESCE((SELECT COUNT(*) FROM "Activity" a WHERE a."userId" = u.id AND a.status::text = 'PLANNED' AND a."scheduledAt" < ${todayStart}), 0) as overdue,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id AND l."deletedAt" IS NULL AND l."leadOrigin" NOT IN ('COLD','REVIVAL') AND l."currentStatus" IN ('Meeting','Site Visit Schedule','Visit Dubai','Want Office Visit','Zoom Meeting','Expo Only')), 0) as closeable,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id AND l."deletedAt" IS NULL AND l."leadOrigin" NOT IN ('COLD','REVIVAL') AND l."needsManagerReview" = true), 0) as needs,
      COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."ownerId" = u.id AND l."deletedAt" IS NULL AND l."leadOrigin" NOT IN ('COLD','REVIVAL')), 0) as clients
    FROM "User" u
    WHERE u.active = true AND u.role::text IN ('AGENT','MANAGER') AND u."hrOnly" = false
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
  // Guard the parse — a corrupt `dailyTargets` setting must NOT 500 the whole
  // dashboard; fall back to defaults (parity with the guarded getDailyTargets()).
  const targets = (() => {
    if (!targetRow) return T;
    try { return { ...T, ...JSON.parse(targetRow.value) }; }
    catch { return T; }
  })();

  // Personal KPI metrics — always userId: me.id (agents AND admin/manager see their OWN numbers).
  // CALL counters are widened to include Buyer-Data work (read-time aggregation):
  //   • connected calls — CallLog counts LEAD connected calls (buyer rows EXCLUDED
  //     via buyerId:null); buyer connected calls come from the BuyerActivity ledger
  //     (buyerConnectedCallsCount) so a telephony buyer call — which writes BOTH a
  //     CallLog and a BuyerActivity — is only counted once. See dashboardWidgets.ts.
  //   • virtual meetings / site-visits(F2F) / fresh clients / deals are lead-only
  //     concepts with NO BuyerActivity equivalent (BuyerActivity has no
  //     meeting/site-visit/cold-to-lead/booking type), so they are unchanged.
  const [connectedLeadCalls, virtualPersonal, f2fPersonal, freshPersonal, dealsPersonal, connectedBuyerCalls, buyerCallsTotal] = await Promise.all([
    prisma.callLog.count({ where: { userId: me.id, buyerId: null, lead: { deletedAt: null }, startedAt: { gte: sqlFrom, lt: sqlTo }, outcome: CallOutcome.CONNECTED } }),
    prisma.activity.count({ where: { userId: me.id, lead: { deletedAt: null }, type: ActivityType.VIRTUAL_MEETING, scheduledAt: { gte: sqlFrom, lt: sqlTo }, status: { not: ActivityStatus.CANCELLED } } }),
    prisma.activity.count({ where: { userId: me.id, lead: { deletedAt: null }, type: { in: [ActivityType.SITE_VISIT, ActivityType.HOME_VISIT, ActivityType.OFFICE_MEETING, ActivityType.EXPO_MEETING] }, scheduledAt: { gte: sqlFrom, lt: sqlTo }, status: { not: ActivityStatus.CANCELLED } } }),
    prisma.activity.count({ where: { userId: me.id, lead: { deletedAt: null }, type: ActivityType.COLD_TO_LEAD, completedAt: { gte: sqlFrom, lt: sqlTo } } }),
    prisma.lead.count({ where: { ownerId: me.id, deletedAt: null, currentStatus: { in: BOOKED_STATUSES }, updatedAt: { gte: sqlFrom, lt: sqlTo } } }),
    // Buyer-Data CALL work by this user, sourced from the BuyerActivity ledger only.
    buyerConnectedCallsCount(prisma, me.id, sqlFrom, sqlTo),
    buyerCallsCount(prisma, me.id, sqlFrom, sqlTo),
  ]);
  // Union the lead-based + buyer-based call figures so Buyer-Data calls reflect on
  // the dashboard without double-counting (buyer side is disjoint — buyerId:null on
  // both CallLog queries, buyer side from BuyerActivity).
  const connectedPersonal = connectedLeadCalls + connectedBuyerCalls;
  const totalCallsPersonal = todayCallsCount + buyerCallsTotal;

  // ── Per-agent morning briefing (also shown to admins) ──
  // What landed since yesterday + what's on the agent's plate today. Mirrors
  // the morning-reminder cron notification but always visible on dashboard so
  // an agent logging in at 10am sees their day at a glance.
  //
  // §12.4 Daily Opening Experience adds:
  //   • Today's mission — the SINGLE most-impactful lead for the agent right
  //     now (priority: hottest untouched > biggest closeable > oldest overdue).
  //   • Time-aware greeting (Morning/Afternoon/Evening/Night in the user's tz).
  //   • Streak nudge so the daily login + follow-up streak feel rewarded.
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [myNewOvernight, myFollowupsToday, myCallbacksToday] = await Promise.all([
    prisma.lead.count({ where: { ownerId: me.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, createdAt: { gte: since24h } } }),
    prisma.activity.count({
      where: {
        userId: me.id,
        lead: { deletedAt: null },
        status: ActivityStatus.PLANNED,
        scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600_000) },
      },
    }),
    prisma.lead.count({
      where: {
        ownerId: me.id,
        deletedAt: null,
        leadOrigin: { notIn: COLD_ORIGINS },
        followupDate: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600_000) },
        currentStatus: { notIn: SUPPRESSED_STATUSES },
      },
    }),
  ]);
  const hasMorningWork = myNewOvernight > 0 || myFollowupsToday > 0 || myCallbacksToday > 0;

  // ── Time-of-day greeting (timezone-aware) ──────────────────────────────
  // The user's wall-clock timezone (India→IST, Dubai→GST) drives the band.
  // The PERSONAL greeting card uses a live CLIENT island (DashboardGreeting)
  // that recomputes from the browser clock and auto-updates across boundaries.
  // The lead-ops card (Sameer) is a simpler one-line header — render a correct
  // server-side band for it here (still tz-aware, never a hardcoded "morning").
  const greetingTz = tzForTeam(me.team);
  const firstName = me.name.split(" ")[0];
  const greeting = greetingFor(new Date(), greetingTz);

  // Daily real-estate sales-motivation quote (one per IST day, same all day).
  const dailyQuote = dashboardQuoteOfTheDay(istDayNumber(Date.now()));

  // Hide the morning check-in section (greeting + quote) once a SALES user has
  // marked "I Am Here" for the day. The IamHereCard already self-hides on
  // check-in; this hides the greeting card alongside it. Admins/lead-ops keep
  // their greeting (the request scopes this to agents / sales users).
  const isSalesUser = me.role === "AGENT" || me.role === "MANAGER";
  const checkedInToday = !!myAttendanceToday?.selfCheckedInAt;
  const hideMorningGreeting = isSalesUser && checkedInToday;

  // ── Reminders widget data ────────────────────────────────────────────
  // Fetch the next 7 days of: scheduled activities (site visits, meetings)
  // + follow-up callbacks (lead.followupDate). Agents see their own;
  // admin/manager see the whole team so they can spot double-bookings and
  // ensure every client has someone attending.
  const reminderEnd = new Date(todayStart.getTime() + 7 * 24 * 3600_000);
  const activityScope: Prisma.ActivityWhereInput = isAdminOrMgr ? teamActWhere : { userId: me.id, lead: { deletedAt: null } };
  const callbackScope: Prisma.LeadWhereInput = isAdminOrMgr ? teamScope : { ownerId: me.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } };

  const [reminderActivities, reminderCallbacks] = await Promise.all([
    prisma.activity.findMany({
      where: {
        ...activityScope,
        status: ActivityStatus.PLANNED,
        type: { in: [ActivityType.SITE_VISIT, ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.EXPO_MEETING] },
        scheduledAt: { gte: todayStart, lt: reminderEnd },
      },
      orderBy: { scheduledAt: "asc" },
      take: 200,
      include: {
        lead: { select: { id: true, name: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.lead.findMany({
      where: {
        ...callbackScope,
        followupDate: { gte: todayStart, lt: reminderEnd },
        currentStatus: { notIn: SUPPRESSED_STATUSES },
      },
      orderBy: { followupDate: "asc" },
      take: 200,
      select: {
        id: true,
        name: true,
        followupDate: true,
        owner: { select: { name: true } },
      },
    }),
  ]);

  // Normalise into a flat ReminderEvent array
  const reminderEvents: ReminderEvent[] = [
    ...reminderActivities
      .filter(a => a.scheduledAt != null && a.lead != null)
      .map(a => ({
        id: a.id,
        leadId: a.lead!.id,
        leadName: formatLeadName(a.lead!.name),
        type: (a.type === "SITE_VISIT" ? "SITE_VISIT" : "MEETING") as ReminderEvent["type"],
        timeIso: a.scheduledAt!.toISOString(),
        agentName: a.user?.name ?? null,
        agentInitials: null,
      })),
    ...reminderCallbacks
      .filter(l => l.followupDate != null)
      .map(l => ({
        id: `cb-${l.id}`,
        leadId: l.id,
        leadName: formatLeadName(l.name),
        type: "CALLBACK" as ReminderEvent["type"],
        timeIso: l.followupDate!.toISOString(),
        agentName: l.owner?.name ?? null,
        agentInitials: null,
      })),
  ];

  // IST today as YYYY-MM-DD (for the week strip default)
  const istOffset2 = 5.5 * 60 * 60 * 1000;
  const todayIsoIST = new Date(Date.now() + istOffset2).toISOString().slice(0, 10);

  // ── Scope-matched drill href builder (count == drill) ──────────────────────
  // A hero card's count is computed over `meScope` (agent → own; admin/manager →
  // teamScope). The /leads drill MUST reproduce that SAME scope or the number
  // won't equal the rows that open. So we pack the right scope params:
  //   • AGENT   → /leads is already owner-scoped (leadScopeWhere) — no seg needed.
  //   • MANAGER → /leads is locked to their team (leadScopeWhere) — no seg needed.
  //   • ADMIN   → must override the /leads "My Leads" default: seg=all for the
  //               "all" view, or seg=india/dubai to match the team toggle.
  const scopeParams = (): Record<string, string> => {
    if (me.role !== "ADMIN") return {};
    if (view === "India") return { seg: "india" };
    if (view === "Dubai") return { seg: "dubai" };
    return { seg: "all" };
  };
  const leadsDrill = (params: Record<string, string>): string => {
    const p = new URLSearchParams({ ...scopeParams(), ...params });
    return `/leads?${p.toString()}`;
  };

  // ── Dashboard Voice Broadcast (Feature 1) — recipient inbox (everyone) +
  //    sender roster (Lalit/Admin only). Separate from lead-specific voice.
  const canSendBc = canSendBroadcast(me);
  const myBroadcastsRaw = await prisma.voiceBroadcast.findMany({
    where: broadcastRecipientWhere(me),
    orderBy: { createdAt: "desc" },
    take: 15,
    select: {
      id: true, createdAt: true, title: true, transcript: true, durationSec: true,
      targetKind: true, targetTeam: true,
      createdBy: { select: { name: true } },
      targetUser: { select: { name: true } },
      reads: { where: { userId: me.id }, select: { id: true } },
    },
  });
  const myBroadcasts = myBroadcastsRaw.map((b) => ({
    id: b.id,
    by: b.createdBy?.name ?? "Admin",
    at: b.createdAt.toISOString(),
    audience: broadcastAudienceLabel({ targetKind: b.targetKind, targetTeam: b.targetTeam, targetUserName: b.targetUser?.name }),
    title: b.title,
    transcript: b.transcript,
    durationSec: b.durationSec,
    heard: b.reads.length > 0,
  }));
  const bcAgents = canSendBc
    ? await prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } }, select: { id: true, name: true, team: true }, orderBy: { name: "asc" } })
    : [];

  return (
    <>
      {/* ── Full-width: testing mode banner ── */}
      {testingModeOn && me.role !== "AGENT" && (
        <div className="card p-3 border-l-4 border-amber-500 bg-amber-50 mb-3">
          <div className="text-sm font-semibold text-amber-900">🧪 Testing mode is ON — every auto-action paused</div>
          <div className="text-xs text-amber-800 mt-0.5">
            Round-robin, SLA escalation, "Needs You" flagging, overnight WhatsApp, and speed-to-lead are all suppressed.
            Manual calls/WA still work. <Link href="/settings" className="underline font-semibold">Switch to live mode →</Link>
          </div>
        </div>
      )}

      {/* ── Full-width: page title + team/action controls ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl sm:text-2xl font-bold">Dashboard</h1>
            {process.env.NEXT_PUBLIC_SANDBOX === "1" && <HelpDot topic="dashboard" />}
          </div>
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
              <span className="on cursor-default opacity-80">{view === "India" ? "🇮🇳 India" : "🇦🇪 Dubai"}</span>
            </div>
          )}
          <Link
            href="/action-list"
            title="Ready-to-close (Meeting/Site Visit/Visit Dubai) + Overdue follow-ups + Manager-flagged leads."
            className="btn btn-gold justify-center"
          >📋 Action List</Link>
        </div>
      </div>

      {/* ── Two-column layout: left = main content, right = sticky Reminders ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">

        {/* ════ LEFT COLUMN — all dashboard content ════ */}
        <div className="space-y-4 min-w-0">

          {/* "I am here" — self-check-in, at the VERY TOP of the dashboard for
              AGENT/MANAGER/ADMIN. Hides once they tap it (per IST day). */}
          {(me.role === "AGENT" || me.role === "MANAGER" || me.role === "ADMIN") && (
            <IamHereCard
              today={myAttendanceToday ? { status: myAttendanceToday.status, markedAt: myAttendanceToday.markedAt.toISOString() } : null}
              checkedIn={!!myAttendanceToday?.selfCheckedInAt}
              userName={me.name}
            />
          )}

          {/* Feature 1 — Dashboard Voice Broadcast. Recipient inbox shows messages
              sent to me (Everyone / my Team / me); sender control is Lalit/Admin only
              (canSendBroadcast). Separate from lead-specific voice guidance. */}
          {canSendBc && <DashboardVoiceBroadcast agents={bcAgents} />}
          <DashboardBroadcastInbox items={myBroadcasts} />

          {/* Field-movement status buttons — agents tap these on their phone in
              the field (arrival / leaving / meeting / site visit). Manager gets
              notified with the duration. Shown to AGENT/MANAGER/ADMIN. */}
          {(me.role === "AGENT" || me.role === "MANAGER" || me.role === "ADMIN") && (
            <AgentStatusBar
              initialEvents={myStatusEvents}
              initialOpenGoing={myOpenGoing}
              alreadyCheckedIn={myCheckedInToday}
              team={me.team}
            />
          )}

          {/* Lead-Ops / Support-Admin management view (Sameer): assignment queue
              instead of personal sales KPIs. */}
          {isLeadOps && mgmt && (
            <>
              <div className="card p-4 border-l-4 border-[#0b1a33] bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900">
                <div className="font-display text-lg font-bold text-[#0b1a33] dark:text-slate-100">🗂️ {greeting}, {firstName} — Lead Management</div>
                <div className="text-xs text-gray-500 mt-0.5">Assignment queue &amp; team workload</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Link href="/leads?owner=unassigned&seg=all" className="card p-4 border-l-4 border-amber-500 hover:shadow-lg transition">
                  <div className="text-3xl font-extrabold text-amber-700">{mgmt.unassigned}</div>
                  <div className="text-xs font-semibold text-amber-900 mt-1">📥 Unassigned Leads</div>
                  <div className="text-[10px] text-amber-700/70 mt-0.5">Need an owner</div>
                </Link>
                <Link href="/admin/awaiting-team" className="card p-4 border-l-4 border-purple-500 hover:shadow-lg transition">
                  <div className="text-3xl font-extrabold text-purple-700">{mgmt.awaitingTeam}</div>
                  <div className="text-xs font-semibold text-purple-900 mt-1">🧭 Awaiting Team</div>
                  <div className="text-[10px] text-purple-700/70 mt-0.5">No team classified yet</div>
                </Link>
                <Link href="/leads?owner=unassigned&seg=all&followup=overdue" className="card p-4 border-l-4 border-red-500 hover:shadow-lg transition">
                  <div className="text-3xl font-extrabold text-red-700">{mgmt.overdueUnassigned}</div>
                  <div className="text-xs font-semibold text-red-900 mt-1">⏰ Overdue · Unassigned</div>
                  <div className="text-[10px] text-red-700/70 mt-0.5">Overdue &amp; still no owner</div>
                </Link>
              </div>
            </>
          )}

          {/* Compact Assignment Queue — for Lalit/admins (NOT lead-ops Sameer, who
              gets the full management view above). Persistent entry point into the
              Unassigned-Leads console; mirrors the left-menu "Unassigned Leads". */}
          {isAdmin && !isLeadOps && mgmt && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
              <Link href="/leads?owner=unassigned&seg=all" className="card p-3 border-l-4 border-amber-500 hover:shadow-lg transition">
                <div className="text-2xl font-extrabold text-amber-700">{mgmt.unassigned}</div>
                <div className="text-[11px] font-semibold text-amber-900 mt-0.5">📥 Unassigned</div>
              </Link>
              <Link href="/leads?owner=unassigned&seg=all&followup=overdue" className="card p-3 border-l-4 border-red-500 hover:shadow-lg transition">
                <div className="text-2xl font-extrabold text-red-700">{mgmt.overdueUnassigned}</div>
                <div className="text-[11px] font-semibold text-red-900 mt-0.5">⏰ Overdue · Unassigned</div>
              </Link>
              <Link href="/admin/awaiting-team" className="card p-3 border-l-4 border-purple-500 hover:shadow-lg transition">
                <div className="text-2xl font-extrabold text-purple-700">{mgmt.awaitingTeam}</div>
                <div className="text-[11px] font-semibold text-purple-900 mt-0.5">🧭 Awaiting Team</div>
              </Link>
            </div>
          )}

          {/* ── Live Lead Assignment & Status widget — ADMIN/MANAGER only.
              Per-agent assignment-by-date grid + summary cards + time/team
              filters + drill-down + auto-refresh. Reuses the agent-performance
              engine (buildAgentReport). AGENTS never see this. */}
          {isAdminOrMgr && (
            <DashboardAssignmentWidget
              role={me.role === "ADMIN" ? "ADMIN" : "MANAGER"}
              meId={me.id}
              lockedTeam={me.role === "MANAGER" ? ((normalizeTeam(me.team) as "India" | "Dubai" | null) ?? null) : null}
              sp={sp}
            />
          )}

          {/* Personal-performance section — hidden for lead-ops/support admins (Sameer). */}
          {!isLeadOps && (<>
          {/* §12.4 Morning briefing / greeting + daily sales quote — at the TOP.
              Hidden for sales users (agents/managers) once they mark "I Am Here". */}
          {!hideMorningGreeting && (
          <div className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/60 to-white dark:from-amber-900/20 dark:to-transparent">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {/* Live, timezone-aware greeting (client island) — auto-updates
                      across Morning/Afternoon/Evening/Night boundaries. */}
                  <DashboardGreeting firstName={firstName} tz={greetingTz} />
                </div>
                <p className="mt-1.5 text-sm italic text-[#6b5a2e] dark:text-amber-200/80">&ldquo;{dailyQuote}&rdquo;</p>
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
          )}

          {/* ── SECTION 1: TODAY ── */}
          <div>
            <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2 uppercase">
              📅 {periodSection}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link href={leadsDrill({ fresh: "untouched" })} className={`card p-4 border-l-4 hover:shadow-lg transition ${freshUntouchedTodayCount > 0 ? "border-red-500 active:bg-red-50" : "border-gray-300 active:bg-gray-50"}`}>
                <div className={`text-3xl font-extrabold ${freshUntouchedTodayCount > 0 ? "text-red-700" : "text-gray-400"}`}>{freshUntouchedTodayCount}</div>
                <div className="text-xs font-semibold text-red-900 dark:text-red-300 mt-1">⚡ Fresh untouched today</div>
                <div className="text-[10px] text-red-700/70 mt-0.5">Assigned today · no first contact yet</div>
              </Link>
              <Link href={leadsDrill({ ai: "HOT", untouched: "1", followup: "all" })} className="card p-4 border-l-4 border-red-500 hover:shadow-lg transition active:bg-red-50">
                <div className="text-3xl font-extrabold text-red-700">{hotUntouched}</div>
                <div className="text-xs font-semibold text-red-900 mt-1">🔥 Hot leads untouched</div>
                <div className="text-[10px] text-red-700/70 mt-0.5">Hot · no contact logged yet</div>
              </Link>
              <Link href={leadsDrill({ followup: "overdue" })} className="card p-4 border-l-4 border-orange-500 hover:shadow-lg transition active:bg-orange-50">
                <div className="text-3xl font-extrabold text-orange-700">{overdueFollowups}</div>
                <div className="text-xs font-semibold text-orange-900 mt-1">⏰ Overdue follow-ups</div>
                <div className="text-[10px] text-orange-700/70 mt-0.5">Follow-up date in the past</div>
              </Link>
              <Link href={leadsDrill({ smart: "visit_potential", followup: "all" })} className="card p-4 border-l-4 border-emerald-500 hover:shadow-lg transition active:bg-emerald-50">
                <div className="text-3xl font-extrabold text-emerald-700">{closableDeals}</div>
                <div className="text-xs font-semibold text-emerald-900 mt-1">💎 Meeting / Visit Stage</div>
                <div className="text-[10px] text-emerald-700/70 mt-0.5">Meeting / visit stage</div>
              </Link>
              <Link href="/cold-calls" className="card p-4 border-l-4 border-blue-500 hover:shadow-lg transition active:bg-blue-50">
                <div className="text-3xl font-extrabold text-blue-700">{coldRevivalOps}</div>
                <div className="text-xs font-semibold text-blue-900 mt-1">🧊 Cold revival</div>
                <div className="text-[10px] text-blue-700/70 mt-0.5">High-value dormant 30+ days</div>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {/* Drill targets carry planned=1 (+ view= for the admin team selector)
                  so /activities "Scheduled Today" reproduces this tile's EXACT
                  where (meActWhere attribution + status:PLANNED + IST-day window).
                  count == drill — see activities/page.tsx todayScheduledWhere. */}
              <Link href={`/activities?type=EXPO_MEETING,OFFICE_MEETING,HOME_VISIT&planned=1${tileViewParam}`} className="card p-4 hover:shadow-lg transition">
                <div className="text-3xl font-extrabold text-teal-700 dark:text-teal-300">{meetingsToday}</div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">🤝 Meetings</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">expo / office / home · today</div>
              </Link>
              <Link href={`/activities?type=SITE_VISIT&planned=1${tileViewParam}`} className="card p-4 hover:shadow-lg transition">
                <div className="text-3xl font-extrabold text-green-700 dark:text-green-300">{siteVisitsToday}</div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">🏗️ Site visits</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">scheduled · today</div>
              </Link>
              <Link href={`/activities?type=VIRTUAL_MEETING&planned=1${tileViewParam}`} className="card p-4 hover:shadow-lg transition">
                <div className="text-3xl font-extrabold text-sky-700 dark:text-sky-300">{virtualMeetingsToday}</div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">💻 Virtual meets</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">scheduled · today</div>
              </Link>
            </div>
          </div>
          </>)}

          {/* Admin morning queue */}
          {me.role === "ADMIN" && morningQueueCount > 0 && (
            <div className="card p-4 border-l-4 border-red-500 bg-red-50">
              <div className="flex items-center justify-between mb-2">
                <div className="font-bold text-red-900">⏰ {morningQueueCount} lead{morningQueueCount === 1 ? "" : "s"} waiting for your assign</div>
                <div className="text-[10px] text-red-700">After 5 min the system auto-assigns to present agents (round-robin)</div>
              </div>
              <div className="space-y-1">
                {morningQueueLeads.map((l) => (
                  <Link key={l.id} href={`/leads/${l.id}`} className="block text-xs p-2 rounded bg-white border border-red-200 hover:border-red-400">
                    <b>{formatLeadName(l.name)}</b> {l.phone && <span className="text-gray-500">· {l.phone}</span>}
                    <span className="text-gray-400 ml-2">{l.forwardedTeam ?? "—"} · {formatDistanceToNow(l.createdAt, { addSuffix: true })}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* §12.4 Morning briefing — moved to TOP of page (above TODAY KPIs) */}

          {!isLeadOps && (<>
          {/* ── SECTION 2: UPCOMING ── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="font-semibold">📆 Future Activities</div>
              <div className="flex gap-2 text-xs flex-wrap">
                {upcomingFollowupsCount > 0 && (
                  <Link href="/leads?followup=future" className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-semibold hover:bg-amber-200">
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
                    <div className="text-sm font-semibold">{a.title}{a.lead && ` · ${formatLeadName(a.lead.name)}`}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{a.scheduledAt && `${fmtIST12(a.scheduledAt)} IST`}</div>
                  </div>
                  <span className="chip chip-new">{a.type}</span>
                </Link>
              ))}
              {upcoming.length === 0 && <div className="text-sm text-gray-500 dark:text-slate-400">Nothing scheduled ahead.</div>}
            </div>
          </div>

          {/* ── DAILY PERFORMANCE ── */}
          <div>
            <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-2 uppercase">
              📊 Daily Performance · {periodSection}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 lg:gap-3">
              <KpiTarget label="Total Calls" achieved={totalCallsPersonal} target={targets.calls} />
              <KpiTarget label="Connected Calls" achieved={connectedPersonal} target={targets.connected} />
              <KpiTarget label="Virtual Meetings" achieved={virtualPersonal} target={targets.virtual} />
              <KpiTarget label="Site Visits (F2F)" achieved={f2fPersonal} target={targets.f2f} />
              <KpiTarget label="Fresh Clients" achieved={freshPersonal} target={targets.fresh} />
              <KpiTarget label="Deals Closed" achieved={dealsPersonal} target={targets.deals} />
            </div>
          </div>
          </>)}

          {/* By Salesperson table — ADMIN/MANAGER only */}
          {isAdminOrMgr && (
            <div className="card p-3 lg:p-5 overflow-x-auto">
              <div className="text-xs font-bold tracking-widest text-gray-500 dark:text-slate-400 mb-3">BY SALESPERSON · TEAM · {periodSection}</div>
              <table className="tbl w-full min-w-[640px]">
                <thead><tr>
                  <th>Salesperson</th><th>Team</th><th className="text-center">Calls</th><th className="text-center">Connected</th><th className="text-center">Due</th><th className="text-center">Overdue</th><th className="text-center">Closeable</th><th className="text-center" title="Open manager escalations — leads this agent flagged for Lalit's review. Click a number to see them.">Needs Lalit</th><th className="text-center">Clients</th>
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
                      <td className={`text-center ${s.needs > 0 ? "text-amber-600 font-bold" : ""}`}>
                        {s.needs > 0
                          ? <Link href={leadsDrill({ owner: s.id, needs: "1" })} className="underline decoration-dotted underline-offset-2 hover:text-amber-800">{s.needs}</Link>
                          : 0}
                      </td>
                      <td className="text-center">{s.clients}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 🎉 Party poppers — personal, hidden for lead-ops admins */}
          {!isLeadOps && (() => {
            const achievedTargets = [
              totalCallsPersonal >= targets.calls   && "calls",
              connectedPersonal >= targets.connected && "connected",
              virtualPersonal  >= targets.virtual   && "virtual",
              f2fPersonal      >= targets.f2f       && "f2f",
              freshPersonal    >= targets.fresh     && "fresh",
              dealsPersonal    >= targets.deals     && "deals",
            ].filter(Boolean) as string[];
            return <TargetCelebration achievedTargets={achievedTargets} date={rawFrom} />;
          })()}

        </div>{/* end LEFT COLUMN */}

        {/* ════ RIGHT COLUMN — sticky Reminders ════ */}
        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] flex flex-col">
          <RemindersCard
            events={reminderEvents}
            todayIso={todayIsoIST}
            showAgent={isAdminOrMgr}
          />
        </div>

      </div>{/* end two-column grid */}
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

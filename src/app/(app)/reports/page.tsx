import { prisma } from "@/lib/prisma";
import { CallOutcome, Prisma } from "@prisma/client";
import { ACTIVE_PURSUIT_STATUSES, CLOSING_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";
import { startOfDay } from "date-fns";
import SourceBarChart from "@/components/charts/SourceBarChart";
import ConnectRateChart from "@/components/charts/ConnectRateChart";
import LegacyFunnelChart from "@/components/charts/FunnelChart";
import StatusFunnelChart from "@/components/FunnelChart";
import SourceChart from "@/components/SourceChart";
import { requireUser } from "@/lib/auth";
import { canAccessDubaiBuyers } from "@/lib/buyerScope";
import { projectWhereForUser } from "@/lib/propertyScope";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { fmtMoneyDual } from "@/lib/money";
import Link from "next/link";
import { normalizeTeam } from "@/lib/teamRouting";
import { sourceBreakdown } from "@/lib/sourceLabel";
import { formatMedium } from "@/lib/mediumManager";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// §9.11 spec: reports should drive decisions, not just count things. We
// prepend three "executive" cards before the legacy charts:
//   1. Weighted revenue forecast — same weights as the dashboard.
//   2. Funnel leakage — biggest drop-off stage so Lalit knows where to coach.
//   3. Stalled deal aging — money tied up in deals that haven't moved.
// Charts below stay for the people who still want raw numbers.

// Forecast weights by Excel status (status-only, no stages).
// Closing statuses = higher probability. Active = baseline.
const FORECAST_WEIGHTS: Record<string, number> = {
  "Booked with Us":       1.00,
  "Booked With Us":       1.00,
  "Visit Dubai":          0.55,
  "Site Visit Schedule":  0.55,
  "Meeting":              0.40,
  "Want Office Visit":    0.40,
  "Zoom Meeting":         0.35,
  "Expo Only":            0.30,
  "Follow Up":            0.15,
  "Long Term Follow Up":  0.08,
  "Details Shared":       0.08,
  "Mail Sent":            0.06,
  "Fresh Lead":           0.04,
  "Not Contacted":        0.02,
  "Funds Issue":          0.05,
  "War Fear":             0.05,
  "Commercial Investment":0.10,
};

// Threshold for "stalled" — days since the lead last changed stage. 7d
// chosen so the card shows a meaningful number on a small team; tune higher
// once the pipeline grows past ~200 active leads.
const STALLED_DAYS = 7;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";

  // AGENT role — show only personal performance reports. No team data,
  // no revenue forecasting, no system metrics.
  if (me.role === "AGENT") {
    return (
      <>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Reports</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            These are your personal performance reports
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Link href="/reports/daily" className="card p-4 border-l-4 border-emerald-500 hover:shadow-md transition">
            <div className="text-2xl">📅</div>
            <div className="font-bold text-sm mt-1">Daily Report</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Target vs Achieved vs Pending — your numbers, per day</div>
          </Link>
          <Link href="/reports/agent-performance" className="card p-4 border-l-4 border-blue-600 hover:shadow-md transition">
            <div className="text-2xl">📈</div>
            <div className="font-bold text-sm mt-1">My Performance</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Your leads, outcomes, calls, meetings &amp; funnel</div>
          </Link>
        </div>

        <div className="card p-4 bg-blue-50 border-l-4 border-blue-400 text-sm text-blue-800">
          Your reports show personal performance only. Contact your manager for team-level data.
        </div>
      </>
    );
  }
  const today = startOfDay(new Date());

  // ── Team filter ────────────────────────────────────────────────────────
  // ADMIN:   All | India | Dubai selector, default All (no forced constraint).
  // MANAGER: Pre-selected to their team, selector rendered but locked (greyed out).
  //          A manager can only see their own team's data — ?team= param is
  //          overridden if it doesn't match their team.
  // AGENT:   No selector shown; data is not team-filtered (own leads only via
  //          the existing scopes).
  const resolvedTeam: "India" | "Dubai" | "all" = (() => {
    if (me.role === "MANAGER") {
      // STRICT: managers always see their own team regardless of URL param.
      return normalizeTeam(me.team) ?? "all";
    }
    if (me.role === "ADMIN") {
      const p = sp.team;
      if (p === "India" || p === "Dubai") return p;
      return "all";
    }
    // AGENT — no team filter on the reports page (own data only via scopes below)
    return "all";
  })();

  const teamScope: Prisma.LeadWhereInput =
    resolvedTeam === "all" ? {} : { forwardedTeam: resolvedTeam };

  // §9.12 Best-time-to-call heatmap — role-scoped raw query.
  // We pass userId as a Prisma parameter rather than string-interpolating
  // (SQL injection + Prisma's parameter binding gives us proper type
  // handling). For ADMIN/MANAGER, pass null and the WHERE-clause OR-branch
  // short-circuits via "$1 IS NULL". DOW is 0=Sun..6=Sat from Postgres.
  // AGENT role returns early above; for ADMIN/MANAGER the heatmap is team-wide.
  const scopedUserId: string | null = null;

  const [
    bySourceRows, callsByDay, funnel, topProjects,
    activeLeadsForForecast, stalledRaw, heatmapRaw,
    statusCounts, sourceByCountRows,
  ] = await Promise.all([
    prisma.lead.findMany({ where: { ...teamScope, deletedAt: null, createdAt: { gte: today } }, select: { source: true, sourceRaw: true } }),

    prisma.$queryRaw<Array<{ d: string; total: number; connected: number }>>`
      SELECT to_char("startedAt"::date, 'YYYY-MM-DD') as d,
             COUNT(*)::int as total,
             SUM(CASE WHEN outcome::text = ${CallOutcome.CONNECTED} THEN 1 ELSE 0 END)::int as connected
      FROM "CallLog" WHERE "startedAt" >= (CURRENT_DATE - INTERVAL '13 days') GROUP BY "startedAt"::date ORDER BY "startedAt"::date ASC`,

    // Status-based funnel — status-only, no stages.
    // total → active-pursuit → closing → booked
    Promise.all([
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } } }),
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, currentStatus: { in: ACTIVE_PURSUIT_STATUSES } } }),
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, currentStatus: { in: CLOSING_STATUSES } } }),
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } } }),
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } } }), // compat slot
      prisma.lead.count({ where: { ...teamScope, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } } }), // compat slot
    ]),

    prisma.project.findMany({
      where: projectWhereForUser(me),
      include: { units: { include: { interestedBy: { include: { lead: true } } } } },
      take: 6,
    }),

    // ── Active pipeline rows for the weighted forecast.
    // Pull only the fields we need; budgetMin can be null for un-qualified
    // leads, those contribute 0 to the forecast.
    // Active leads for forecast — all active-pursuit and closing statuses
    prisma.lead.findMany({
      where: { ...teamScope, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, currentStatus: { in: [...ACTIVE_PURSUIT_STATUSES, ...CLOSING_STATUSES, ...BOOKED_STATUSES] } },
      select: { currentStatus: true, budgetMin: true, budgetCurrency: true },
    }),

    // ── Stalled-deal raw query.
    // We need the most recent STATUS_CHANGE per lead to compute "days in
    // current stage". One CTE picks the latest STATUS_CHANGE row per lead,
    // then we left-join back so leads that have NEVER changed stage still
    // show up (we fall back to lead.createdAt for those).
    //
    // STALLED_DAYS is passed as a parameter (Number, not string) so Postgres
    // can multiply against INTERVAL '1 day'. We can't `${}`-interpolate
    // inside an `INTERVAL 'N days'` string literal — Prisma's $queryRaw
    // would turn it into a placeholder inside quotes which is invalid SQL.
    // teamFilter is null when we want all teams, or the team string for scoped queries.
    (resolvedTeam === "all"
      ? prisma.$queryRaw<Array<{ id: string; status: string; budget_min: number | null; currency: string | null; entered_at: Date }>>`
          WITH latest_change AS (
            SELECT DISTINCT ON ("leadId") "leadId", "createdAt"
            FROM "Activity"
            WHERE "type" = 'STATUS_CHANGE'
            ORDER BY "leadId", "createdAt" DESC
          )
          SELECT l."id" as id,
                 l."currentStatus" as status,
                 l."budgetMin" as budget_min,
                 l."budgetCurrency" as currency,
                 COALESCE(lc."createdAt", l."createdAt") as entered_at
          FROM "Lead" l
          LEFT JOIN latest_change lc ON lc."leadId" = l."id"
          WHERE l."currentStatus" IN ('Meeting','Site Visit Schedule','Visit Dubai','Want Office Visit','Zoom Meeting','Expo Only')
            AND l."deletedAt" IS NULL
            AND COALESCE(lc."createdAt", l."createdAt") < NOW() - (${STALLED_DAYS} * INTERVAL '1 day')
        `
      : prisma.$queryRaw<Array<{ id: string; status: string; budget_min: number | null; currency: string | null; entered_at: Date }>>`
          WITH latest_change AS (
            SELECT DISTINCT ON ("leadId") "leadId", "createdAt"
            FROM "Activity"
            WHERE "type" = 'STATUS_CHANGE'
            ORDER BY "leadId", "createdAt" DESC
          )
          SELECT l."id" as id,
                 l."currentStatus" as status,
                 l."budgetMin" as budget_min,
                 l."budgetCurrency" as currency,
                 COALESCE(lc."createdAt", l."createdAt") as entered_at
          FROM "Lead" l
          LEFT JOIN latest_change lc ON lc."leadId" = l."id"
          WHERE l."currentStatus" IN ('Meeting','Site Visit Schedule','Visit Dubai','Want Office Visit','Zoom Meeting','Expo Only')
            AND l."forwardedTeam" = ${resolvedTeam}
            AND l."deletedAt" IS NULL
            AND COALESCE(lc."createdAt", l."createdAt") < NOW() - (${STALLED_DAYS} * INTERVAL '1 day')
        `),

    // ── Best time to call heatmap (last 30 days, IST tz).
    // Role-scoped: AGENT sees own calls only; ADMIN/MANAGER see all.
    // We pass scopedUserId as a parameter — when it's null the OR-clause
    // matches every row regardless of "userId".
    prisma.$queryRaw<Array<{ dow: number; hour: number; total: number; connected: number }>>`
      SELECT
        EXTRACT(DOW FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int as dow,
        EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata')::int as hour,
        COUNT(*)::int as total,
        SUM(CASE WHEN outcome::text = 'CONNECTED' THEN 1 ELSE 0 END)::int as connected
      FROM "CallLog"
      WHERE "startedAt" >= NOW() - INTERVAL '30 days'
        AND (${scopedUserId}::text IS NULL OR "userId" = ${scopedUserId})
      GROUP BY dow, hour
    `,

    // ── Status-level funnel for the new StatusFunnelChart at top of page.
    // AGENT role returns early above, so me.role here is ADMIN | MANAGER.
    // MANAGER: locked to their team. ADMIN: respects the current teamScope filter.
    // Count leads by currentStatus (Excel status) — status-only, no stages.
    prisma.lead.groupBy({
      by: ["currentStatus"],
      _count: { _all: true },
      where: me.role === "MANAGER"
        ? { forwardedTeam: normalizeTeam(me.team) ?? undefined, deletedAt: null }
        : { ...teamScope, deletedAt: null },
    }),

    // ── Source analytics — all-time, sources by count.
    // Read verbatim sourceRaw via sourceBreakdown (top 12 sliced below).
    // Also pulls medium/mediumOther so the Leads-by-Medium card below reuses
    // this same scoped fetch (no extra query).
    prisma.lead.findMany({
      where: { ...teamScope, deletedAt: null },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true },
    }),
  ]);

  // Group the raw {source, sourceRaw} rows into effective-source breakdowns.
  const bySource = sourceBreakdown(bySourceRows);              // -> { source, n }[]
  const sourceByCount = sourceBreakdown(sourceByCountRows).slice(0, 12); // top 12

  // Leads-by-medium (contact channel) — all-time, same team scope as sources.
  // Custom mediums resolve via formatMedium; null medium → "—". Sorted desc.
  const mediumCounts = new Map<string, number>();
  for (const r of sourceByCountRows) {
    const key = r.medium ? formatMedium(r.medium, r.mediumOther) : "—";
    mediumCounts.set(key, (mediumCounts.get(key) ?? 0) + 1);
  }
  const byMedium = [...mediumCounts.entries()]
    .map(([medium, n]) => ({ medium, n }))
    .sort((a, b) => b.n - a.n);
  const byMediumTotal = byMedium.reduce((s, m) => s + m.n, 0);

  // Leads-by-property-type (asset class) — all-time, same team scope as sources.
  // Leads with no type set → "—". Sorted desc.
  const ptCounts = new Map<string, number>();
  for (const r of sourceByCountRows) {
    const key = r.propertyType && r.propertyType.trim() ? r.propertyType : "—";
    ptCounts.set(key, (ptCounts.get(key) ?? 0) + 1);
  }
  const byPropertyType = [...ptCounts.entries()]
    .map(([type, n]) => ({ type, n }))
    .sort((a, b) => b.n - a.n);
  const byPropertyTypeTotal = byPropertyType.reduce((s, p) => s + p.n, 0);

  const [tot, contacted, qualified, , ] = funnel; // status-based: total, active, closing, booked(×2)

  // ── Build status funnel stages for StatusFunnelChart ─────────────────
  // Status-only — no stage system. Show all Excel statuses by count.
  const STATUS_ORDER = [
    "Not Contacted", "Fresh Lead", "Follow Up", "Long Term Follow Up",
    "Details Shared", "Mail Sent", "Meeting", "Want Office Visit",
    "Zoom Meeting", "Site Visit Schedule", "Visit Dubai", "Expo Only",
    "Funds Issue", "War Fear", "Commercial Investment",
    "Booked with Us",
  ];
  const countMap: Record<string, number> = {};
  for (const row of statusCounts) {
    if (row.currentStatus) countMap[row.currentStatus] = row._count._all;
  }
  const totalActive = Object.values(countMap).reduce((sum, c) => sum + c, 0);
  const funnelStages = STATUS_ORDER.map((s) => {
    const count = countMap[s] ?? 0;
    const percent = totalActive > 0 ? (count / totalActive) * 100 : 0;
    return { label: s, count, percent };
  }).filter(f => f.count > 0);

  const conversionRates = funnelStages.slice(0, -1).map((stage, i) => {
    const next = funnelStages[i + 1];
    if (stage.count === 0) return 0;
    return Math.round((next.count / stage.count) * 100);
  });

  // ── Compute decision metrics ───────────────────────────────────────
  // Weighted forecast — sum(budgetMin * weight per stage), split by currency
  // so AED and INR don't get incorrectly added together.
  let forecastAed = 0;
  let forecastInr = 0;
  for (const l of activeLeadsForForecast) {
    if (!l.budgetMin) continue;
    const w = FORECAST_WEIGHTS[l.currentStatus ?? ""] ?? 0;
    const weighted = l.budgetMin * w;
    if (l.budgetCurrency === "INR") forecastInr += weighted;
    else forecastAed += weighted;
  }

  // Funnel leakage — find the biggest % drop between adjacent stages.
  // We re-use the existing funnel counts so the metric matches the chart.
  const funnelPairs: Array<{ from: string; to: string; lost: number; pct: number }> = [];
  // Status-based funnel leakage: total → active → closing → booked
  const labels = [
    { from: "All Leads",     to: "Active Pursuit", count: tot,       next: contacted },
    { from: "Active Pursuit",to: "Closing Stage",  count: contacted, next: qualified },
    { from: "Closing Stage", to: "Booked with Us", count: qualified, next: qualified },
  ];
  for (const p of labels) {
    if (p.count === 0) continue;
    const lost = p.count - p.next;
    const pct = Math.round((lost / p.count) * 100);
    funnelPairs.push({ from: p.from, to: p.to, lost, pct });
  }
  const biggestLeak = [...funnelPairs].sort((a, b) => b.pct - a.pct)[0] ?? null;

  // Stalled aging — group by stage, compute money tied up + oldest age.
  const stalledByStage: Record<string, { count: number; aed: number; inr: number; oldestDays: number }> = {};
  for (const r of stalledRaw) {
    const k = r.status;
    if (!stalledByStage[k]) stalledByStage[k] = { count: 0, aed: 0, inr: 0, oldestDays: 0 };
    stalledByStage[k].count += 1;
    const age = Math.max(0, Math.floor((Date.now() - new Date(r.entered_at).getTime()) / 86_400_000));
    if (age > stalledByStage[k].oldestDays) stalledByStage[k].oldestDays = age;
    if (r.budget_min) {
      if (r.currency === "INR") stalledByStage[k].inr += r.budget_min;
      else stalledByStage[k].aed += r.budget_min;
    }
  }
  const stalledTotal = Object.values(stalledByStage).reduce((s, x) => s + x.count, 0);
  const stalledMoneyAed = Object.values(stalledByStage).reduce((s, x) => s + x.aed, 0);
  const stalledMoneyInr = Object.values(stalledByStage).reduce((s, x) => s + x.inr, 0);

  // ── Heatmap data prep ──────────────────────────────────────────────
  // Build a sparse 7x24 grid (Sun=0..Sat=6, hour 0..23). Cells with no
  // call data render as a faint placeholder. Connect-rate drives the
  // saturation; we also track totals for the tooltip.
  type HeatCell = { total: number; connected: number };
  const heatGrid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ total: 0, connected: 0 }))
  );
  for (const r of heatmapRaw) {
    if (r.dow < 0 || r.dow > 6 || r.hour < 0 || r.hour > 23) continue;
    heatGrid[r.dow][r.hour] = { total: Number(r.total), connected: Number(r.connected) };
  }

  // Best slot = highest connect-rate among cells with ≥3 calls (avoid
  // a single lucky pickup looking like a 100% slot).
  const MIN_CALLS_FOR_BEST = 3;
  let bestSlot: { dow: number; hour: number; rate: number; total: number } | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = heatGrid[d][h];
      if (c.total < MIN_CALLS_FOR_BEST) continue;
      const rate = c.connected / c.total;
      if (!bestSlot || rate > bestSlot.rate) {
        bestSlot = { dow: d, hour: h, rate, total: c.total };
      }
    }
  }

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // §9.12 fix (Lalit feedback 2026-06): the old `12a/12p` short labels were
  // ambiguous in narrow columns — managers couldn't tell midnight from noon
  // at a glance, and the "best slot" line read "12p IST" which Lalit flagged
  // as "AM/PM wrong". We now render unambiguous `am/pm` everywhere and use
  // an Intl IST formatter for the recommendation line so the timezone math
  // is anchored to Asia/Kolkata (not the runner's TZ).
  const fmtHour = (h: number) => {
    if (h === 0) return "12am";
    if (h === 12) return "12pm";
    if (h < 12) return `${h}am`;
    return `${h - 12}pm`;
  };
  const fmtHourTooltip = (h: number) => `${String(h).padStart(2, "0")}:00`;
  // Intl-backed IST formatter for the "best slot" sentence. Anchored to a
  // fixed UTC date, then we shift the hour and ask Intl for IST am/pm.
  // Using an explicit timeZone here protects against the heatmap rendering
  // a different label than the SQL grouping if the JS host TZ drifts.
  const fmtHourIST = (h: number): string => {
    // Build an arbitrary UTC instant at hour=h in IST (UTC+5:30):
    // IST hour h ⇔ UTC hour (h - 5.5) on 2024-01-01. Day wrap is fine —
    // Intl renders just the hour with am/pm so the date is irrelevant.
    const utcMinutes = h * 60 - 330; // IST is UTC+330 minutes
    const d = new Date(Date.UTC(2024, 0, 1, 0, utcMinutes, 0));
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }).format(d).replace(/\s/g, "").toLowerCase();
  };
  // Tailwind needs static class names; pre-pick emerald shades by bucket.
  const cellClass = (rate: number, total: number): string => {
    if (total === 0) return "bg-gray-50 text-gray-300";
    if (rate >= 0.75) return "bg-emerald-600 text-white";
    if (rate >= 0.55) return "bg-emerald-500 text-white";
    if (rate >= 0.40) return "bg-emerald-400 text-emerald-950";
    if (rate >= 0.25) return "bg-emerald-300 text-emerald-950";
    if (rate >= 0.10) return "bg-emerald-200 text-emerald-900";
    return "bg-emerald-100 text-emerald-900";
  };

  const projectStats = topProjects.map(p => {
    const leadIds = new Set<string>();
    for (const u of p.units) for (const l of u.interestedBy) leadIds.add(l.leadId);
    const leads = leadIds.size;
    return { name: p.name, leads, bookings: Math.floor(leads / 12) };
  }).sort((a, b) => b.leads - a.leads);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">
            {resolvedTeam === "Dubai" ? "🇦🇪 Dubai — Reports" :
             resolvedTeam === "India" ? "🇮🇳 India — Reports" :
             "Reports"}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500">Decisions first · raw numbers below · live</p>
        </div>
        {/* Team filter — shown for ADMIN (full control) and MANAGER (locked to their team) */}
        {isAdminOrMgr && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {me.role === "MANAGER" ? (
              /* Manager: selector shown but effectively locked to their team */
              <div className="seg opacity-60 cursor-not-allowed" title="Team filter is locked to your team">
                <span className={resolvedTeam === "Dubai" ? "on pointer-events-none" : "pointer-events-none"}>🇦🇪 Dubai</span>
                <span className={resolvedTeam === "India" ? "on pointer-events-none" : "pointer-events-none"}>🇮🇳 India</span>
                <span className="pointer-events-none">All</span>
              </div>
            ) : (
              /* Admin: fully interactive */
              <div className="seg">
                <Link href="/reports?team=Dubai" className={resolvedTeam === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
                <Link href="/reports?team=India" className={resolvedTeam === "India" ? "on" : ""}>🇮🇳 India</Link>
                <Link href="/reports" className={resolvedTeam === "all" ? "on" : ""}>All</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* §9.11 Decisions strip — lead with the three questions Lalit cares
          about: "How much money is coming?", "Where am I losing deals?",
          "What deals are stuck?". Each links to the underlying drill-down. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. WEIGHTED REVENUE FORECAST */}
        <Link href="/leads" className="card p-4 border-l-4 border-emerald-500 hover:shadow-lg transition active:bg-emerald-50">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">
            💰 Forecasted revenue
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 leading-tight">
            {fmtMoneyDual({ aed: forecastAed, inr: forecastInr })}
          </div>
          <div className="text-[11px] text-emerald-700/70 mt-1">
            Weighted active pipeline · all teams · status changes update this
          </div>
        </Link>

        {/* 2. FUNNEL LEAKAGE */}
        <Link href="#funnel" className="card p-4 border-l-4 border-rose-500 hover:shadow-lg transition active:bg-rose-50">
          <div className="text-[10px] uppercase tracking-widest text-rose-700 font-bold">
            🕳 Biggest funnel leak
          </div>
          {biggestLeak ? (
            <>
              <div className="text-xl sm:text-2xl font-extrabold text-rose-800 mt-1 leading-tight">
                {biggestLeak.pct}% lost
              </div>
              <div className="text-[11px] text-rose-700/70 mt-1">
                {biggestLeak.from} → {biggestLeak.to} · {biggestLeak.lost} leads dropping off · coach this step
              </div>
            </>
          ) : (
            <>
              <div className="text-xl sm:text-2xl font-extrabold text-gray-400 mt-1 leading-tight">—</div>
              <div className="text-[11px] text-gray-500 mt-1">No funnel data yet</div>
            </>
          )}
        </Link>

        {/* 3. STALLED DEAL AGING */}
        <Link href="/leads?when=overdue" className="card p-4 border-l-4 border-amber-500 hover:shadow-lg transition active:bg-amber-50">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">
            ⏳ Stalled deals
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-amber-800 mt-1 leading-tight">
            {stalledTotal} <span className="text-sm font-semibold">stuck &gt;{STALLED_DAYS}d</span>
          </div>
          <div className="text-[11px] text-amber-700/70 mt-1">
            {stalledTotal > 0
              ? `${fmtMoneyDual({ aed: stalledMoneyAed, inr: stalledMoneyInr })} tied up — push or close`
              : "All active deals are moving"}
          </div>
        </Link>
      </div>

      {/* Stalled breakdown table — only shows when there's actual stalled data
          so the page doesn't look empty for healthy teams. */}
      {stalledTotal > 0 && (
        <div className="card p-4">
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-2">
            Stalled deals by stage
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            {(["Meeting", "Site Visit Schedule", "Visit Dubai"] as const).map((s) => {
              const x = stalledByStage[s];
              if (!x || x.count === 0) {
                return (
                  <div key={s} className="p-3 rounded-lg border bg-gray-50">
                    <div className="text-[11px] font-semibold text-gray-500">{s}</div>
                    <div className="text-lg font-bold text-gray-400 mt-1">0</div>
                  </div>
                );
              }
              return (
                <div key={s} className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="text-[11px] font-semibold text-amber-900">{s}</div>
                  <div className="text-lg font-bold text-amber-900 mt-1">{x.count} <span className="text-xs font-semibold text-amber-800">stalled</span></div>
                  <div className="text-[11px] text-amber-800/80 mt-0.5">
                    Oldest: {x.oldestDays}d · {fmtMoneyDual({ aed: x.aed, inr: x.inr })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Conversion funnel ──────────────────────────────────────────────
          Shows every Excel status as a horizontal bar chart so
          Lalit can see at a glance where leads are piling up. Rendered
          prominently above the nav links so it's the first thing visible. */}
      <div className="card p-5">
        <div className="text-xs text-gray-500 tracking-widest uppercase mb-1">
          Conversion funnel · active pipeline
        </div>
        <div className="font-semibold text-sm mb-3">
          Leads by stage
          {resolvedTeam !== "all" && (
            <span className="ml-2 text-[11px] text-gray-400 font-normal">
              ({resolvedTeam} team)
            </span>
          )}
        </div>
        <StatusFunnelChart stages={funnelStages} conversionRates={conversionRates} />
        <div className="mt-2 text-[10px] text-gray-400">
          Bar width = % of active pipeline (WON bar relative to active + won). LOST leads excluded.
        </div>
      </div>

      {/* ── Source analytics bar chart ───────────────────────────────────
          All-time lead counts by source, top 12, scoped to current team
          filter. Placed here so the two funnel-level views sit together. */}
      <div className="card p-5">
        <SourceChart data={sourceByCount.map(s => ({ source: s.source, _count: { _all: s.n } }))} />
      </div>

      {/* ── Leads by Medium (contact channel) ─────────────────────────────
          All-time counts by the channel the lead came through (Call/WhatsApp/
          Email + customs), same team scope as the source chart. Compact bar
          list — the full medium funnel (conversion %) lives in /reports/sources. */}
      {byMedium.length > 0 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0b1a33]">Leads by Medium</h2>
            <Link href="/reports/sources" className="text-[11px] text-violet-600 hover:underline">Full funnel →</Link>
          </div>
          <div className="space-y-2">
            {byMedium.map((m) => {
              const pct = byMediumTotal > 0 ? (m.n / byMediumTotal) * 100 : 0;
              return (
                <div key={m.medium} className="flex items-center gap-3">
                  <div className="w-24 sm:w-28 text-xs text-gray-600 dark:text-slate-300 truncate" title={m.medium}>{m.medium}</div>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-slate-700 rounded overflow-hidden">
                    <div className="h-full bg-violet-500/80 rounded" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <div className="w-20 text-right text-xs tabular-nums text-gray-700 dark:text-slate-200">
                    {m.n} <span className="text-gray-400">({pct.toFixed(0)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-gray-400">
            {byMediumTotal} leads · channel set on the lead (Call · WhatsApp · Email · custom). &ldquo;—&rdquo; = no medium recorded.
          </div>
        </div>
      )}

      {/* ── Leads by Property Type (asset class) ──────────────────────────
          All-time counts by the asset class (Residential / Commercial / Mixed
          Use), same team scope as the source chart. Compact bar list — the full
          property-type funnel (conversion %) lives in /reports/sources. */}
      {byPropertyType.length > 0 && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-base sm:text-lg font-bold text-[#0b1a33]">Leads by Property Type</h2>
            <Link href="/reports/sources" className="text-[11px] text-emerald-600 hover:underline">Full funnel →</Link>
          </div>
          <div className="space-y-2">
            {byPropertyType.map((p) => {
              const pct = byPropertyTypeTotal > 0 ? (p.n / byPropertyTypeTotal) * 100 : 0;
              return (
                <div key={p.type} className="flex items-center gap-3">
                  <div className="w-24 sm:w-28 text-xs text-gray-600 dark:text-slate-300 truncate" title={p.type}>{p.type}</div>
                  <div className="flex-1 h-5 bg-gray-100 dark:bg-slate-700 rounded overflow-hidden">
                    <div className="h-full bg-emerald-500/80 rounded" style={{ width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <div className="w-20 text-right text-xs tabular-nums text-gray-700 dark:text-slate-200">
                    {p.n} <span className="text-gray-400">({pct.toFixed(0)}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-gray-400">
            {byPropertyTypeTotal} leads · asset class set on the lead (Residential · Commercial · Mixed Use). &ldquo;—&rdquo; = no type recorded.
          </div>
        </div>
      )}

      {/* Primary report navigation — these are the everyday reports */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Link href="/reports/agent-performance" className="card p-4 border-l-4 border-blue-600 hover:shadow-md transition">
          <div className="text-2xl">📈</div>
          <div className="font-bold text-sm mt-1">Agent Performance</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Per-agent leads, outcomes, calls, meetings, funnel · by assignment history</div>
        </Link>
        {canAccessDubaiBuyers(me) && (
          <Link href="/reports/buyer-performance" className="card p-4 border-l-4 border-blue-400 hover:shadow-md transition">
            <div className="text-2xl">🇦🇪</div>
            <div className="font-bold text-sm mt-1">Dubai Buyer Data Performance</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Per-agent Dubai buyers assigned, converted, returned, attempts &amp; funnel · pool health</div>
          </Link>
        )}
        <Link href="/reports/daily" className="card p-4 border-l-4 border-emerald-500 hover:shadow-md transition">
          <div className="text-2xl">📅</div>
          <div className="font-bold text-sm mt-1">Daily Report</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Target vs Achieved vs Pending — per agent, per day</div>
        </Link>
        <Link href="/reports/sla" className="card p-4 border-l-4 border-amber-500 hover:shadow-md transition">
          <div className="text-2xl">📊</div>
          <div className="font-bold text-sm mt-1">SLA & Meetings</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Site/Office/Virtual: scheduled, rescheduled, no-show</div>
        </Link>
        <Link href="/reports/travel" className="card p-4 border-l-4 border-sky-500 hover:shadow-md transition">
          <div className="text-2xl">🚗</div>
          <div className="font-bold text-sm mt-1">Travel Reimbursement</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Km × per-km rate, monthly per agent</div>
        </Link>
        {/* Lead Source Breakdown — which sources are actually closing,
            with full funnel + first-call latency per source. Admin/Manager only. */}
        <Link href="/reports/sources" className="card p-4 border-l-4 border-violet-500 hover:shadow-md transition">
          <div className="text-2xl">🎯</div>
          <div className="font-bold text-sm mt-1">Lead Sources</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Per-source funnel, conversion %, first-call latency</div>
        </Link>
        {/* Cooling Leads — HOT leads that just downgraded to WARM/COLD. Save-the-deal list. */}
        <Link href="/reports/cooling" className="card p-4 border-l-4 border-rose-500 hover:shadow-md transition">
          <div className="text-2xl">🌡</div>
          <div className="font-bold text-sm mt-1">Cooling leads</div>
          <div className="text-[10px] text-gray-500 mt-0.5">HOT → WARM/COLD in the last 14 days — re-engage now</div>
        </Link>
        {/* Team comparison — Dubai vs India head-to-head over a chosen window.
            Admin/Manager only (RBAC enforced on the destination page). */}
        <Link href="/reports/team-comparison" className="card p-4 border-l-4 border-indigo-500 hover:shadow-md transition">
          <div className="text-2xl">🏆</div>
          <div className="font-bold text-sm mt-1">Team comparison</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Dubai vs India side-by-side · weighted winner</div>
        </Link>
        {/* Commission & earnings — booked-deal commissions by status, agent
            and booking, currency-correct (AED + INR never summed). Admin/Manager only. */}
        <Link href="/reports/commission" className="card p-4 border-l-4 border-emerald-600 hover:shadow-md transition">
          <div className="text-2xl">💰</div>
          <div className="font-bold text-sm mt-1">Commission &amp; earnings</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Booked, received, outstanding · per agent · per booking</div>
        </Link>
        {/* Year-to-Date — Jan 1 → today, Dubai vs India side-by-side.
            All 9 YTD metrics in one screen. Admin/Manager only. */}
        <Link href="/reports/ytd" className="card p-4 border-l-4 border-teal-500 hover:shadow-md transition">
          <div className="text-2xl">📅</div>
          <div className="font-bold text-sm mt-1">Year-to-Date</div>
          <div className="text-[10px] text-gray-500 mt-0.5">YTD leads, bookings, won, commission · Dubai vs India</div>
        </Link>
        <a href="#pipeline-overview" className="card p-4 border-l-4 border-[#c9a24b] hover:shadow-md transition active:bg-amber-50 block">
          <div className="text-2xl">📈</div>
          <div className="font-bold text-sm mt-1">Pipeline overview</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Funnel, source mix, agent performance · below ↓</div>
        </a>
        <Link href="/reports/leaderboard" className="card p-4 border-l-4 border-yellow-500 hover:shadow-md transition">
          <div className="text-2xl">🏆</div>
          <div className="font-bold text-sm mt-1">Leaderboard</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Agent call volume and conversion performance</div>
        </Link>
        <Link href="/reports/activity" className="card p-4 border-l-4 border-purple-500 hover:shadow-md transition">
          <div className="text-2xl">📋</div>
          <div className="font-bold text-sm mt-1">Activity Feed</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Today&apos;s calls and lead updates by agent</div>
        </Link>
        <Link href="/reports/changes" className="card p-4 border-l-4 border-slate-500 hover:shadow-md transition">
          <div className="text-2xl">📜</div>
          <div className="font-bold text-sm mt-1">Change Report</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Who changed what — field-level audit trail by user</div>
        </Link>
      </div>

      {isAdmin ? (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">CSV exports (admin-only):</span>
          <a href="/api/reports/export?type=leads" className="btn btn-ghost text-xs">Leads CSV</a>
          <a href="/api/reports/export?type=calls" className="btn btn-ghost text-xs">Calls CSV</a>
        </div>
      ) : (
        <div className="text-[11px] text-gray-500 italic">CSV export is Admin-only · contact Lalit for a watermarked extract</div>
      )}

      <div id="pipeline-overview" className="grid grid-cols-1 lg:grid-cols-3 gap-4 scroll-mt-20">
        {/* Source breakdown is admin/manager-only (channel mix is sensitive — agents
            shouldn't be able to back-derive which campaigns / portals we lean on,
            same policy as the leads list page filter at leads/page.tsx:57). */}
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">DAILY · TODAY</div>
          <div className="font-semibold mt-1">Lead intake by source</div>
          <SourceBarChart data={bySource} />
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">LAST 14 DAYS</div>
          <div className="font-semibold mt-1">Call connect rate</div>
          <ConnectRateChart data={callsByDay.map(r => ({ d: r.d, rate: r.total ? Math.round((Number(r.connected) / Number(r.total)) * 100) : 0 }))} />
        </div>
      </div>

      <div id="funnel" className="grid grid-cols-1 lg:grid-cols-3 gap-4 scroll-mt-20">
        <div className="card p-5 lg:col-span-2">
          <div className="text-xs text-gray-500 tracking-widest">ALL TIME · ALL TEAMS</div>
          <div className="font-semibold mt-1">Conversion funnel</div>
          <LegacyFunnelChart data={[
            { stage: "All Leads", n: tot },
            { stage: "Active Pursuit", n: contacted },
            { stage: "Closing Stage", n: qualified },
          ]} />
          {/* Funnel-pair leakage table — exposes the same numbers powering
              the "biggest leak" card so Lalit can see all transitions, not
              just the worst one. */}
          {funnelPairs.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {funnelPairs.map((p) => (
                <div key={p.from} className={`p-2 rounded border ${p.pct >= 50 ? "border-rose-300 bg-rose-50" : p.pct >= 30 ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{p.from} → {p.to}</div>
                  <div className="font-bold text-sm mt-0.5">{p.pct}% lost</div>
                  <div className="text-[10px] text-gray-500">{p.lost} leads</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">ALL TIME</div>
          <div className="font-semibold mt-1">Top performing projects</div>
          <table className="w-full text-sm mt-2">
            <thead><tr className="text-xs text-gray-500"><th className="text-left py-1">Project</th><th>Leads</th><th>Bookings</th></tr></thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              {projectStats.map(p => (
                <tr key={p.name}><td className="py-2">{p.name}</td><td className="text-center">{p.leads}</td><td className="text-center font-semibold">{p.bookings}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* §9.12 Best time to call — DOW × hour-of-day heatmap (IST, 30d).
          Connect-rate drives the color so Lalit can see at-a-glance when
          his pickups happen. AGENTS see their own calls; ADMIN/MANAGER
          see the whole team. */}
      <div className="card p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs text-gray-500 tracking-widest">LAST 30 DAYS · IST</div>
            <div className="font-semibold mt-1">🕓 Best time to call</div>
          </div>
          <div className="text-[10px] text-gray-500">
            {scopedUserId ? "Your calls only" : "All agents · team-wide"}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <div className="inline-block min-w-full">
            {/* Hour header row: empty corner + 24 hour labels */}
            <div className="grid grid-cols-[36px_repeat(24,minmax(22px,1fr))] gap-px text-[9px] text-gray-500 mb-1">
              <div></div>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center font-medium">{fmtHour(h)}</div>
              ))}
            </div>
            {/* 7 day rows */}
            {DAY_LABELS.map((dayLabel, d) => (
              <div key={d} className="grid grid-cols-[36px_repeat(24,minmax(22px,1fr))] gap-px mb-px">
                <div className="text-[10px] text-gray-600 font-semibold flex items-center justify-end pr-1.5">
                  {dayLabel}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const cell = heatGrid[d][h];
                  const rate = cell.total > 0 ? cell.connected / cell.total : 0;
                  const pct = Math.round(rate * 100);
                  const title = cell.total === 0
                    ? `${dayLabel} ${fmtHourTooltip(h)} IST · no calls`
                    : `${dayLabel} ${fmtHourTooltip(h)} IST · ${cell.total} call${cell.total === 1 ? "" : "s"} · ${pct}% connected`;
                  return (
                    <div
                      key={h}
                      title={title}
                      className={`h-7 rounded-sm text-[9px] font-semibold flex items-center justify-center ${cellClass(rate, cell.total)}`}
                    >
                      {cell.total > 0 ? `${pct}` : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500 flex-wrap">
          <span>Less</span>
          <span className="inline-block w-3 h-3 rounded-sm bg-gray-50 border border-gray-200" />
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" />
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-300" />
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600" />
          <span>More connects</span>
          <span className="ml-auto">Cells show connect %. Needs ≥{MIN_CALLS_FOR_BEST} calls to be a "best slot".</span>
        </div>

        {bestSlot ? (
          <div className="mt-2">
            <div className="text-sm font-medium text-emerald-800">
              {bestSlot.hour < 8 || bestSlot.hour >= 21 ? "⚠️" : "💡"} Best slot:{" "}
              {DAY_LABELS[bestSlot.dow]} {fmtHourIST(bestSlot.hour)} IST
              ({Math.round(bestSlot.rate * 100)}% connect · {bestSlot.total} calls)
            </div>
            {(bestSlot.hour < 8 || bestSlot.hour >= 21) && (
              <p className="text-[10px] text-gray-400 mt-1">* Times shown in IST. Off-hours slots may reflect call log timestamps that were recorded after midnight. Focus on 9am–8pm slots for reliable patterns.</p>
            )}
          </div>
        ) : (
          <div className="mt-2 text-xs text-gray-500 italic">
            Not enough call data yet — log at least {MIN_CALLS_FOR_BEST} calls in any DOW/hour slot to unlock a recommendation.
          </div>
        )}
      </div>
    </>
  );
}

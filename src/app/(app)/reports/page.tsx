import { prisma } from "@/lib/prisma";
import { LeadStatus, CallOutcome } from "@prisma/client";
import { startOfDay } from "date-fns";
import SourceBarChart from "@/components/charts/SourceBarChart";
import AgentBarChart from "@/components/charts/AgentBarChart";
import ConnectRateChart from "@/components/charts/ConnectRateChart";
import FunnelChart from "@/components/charts/FunnelChart";
import { requireUser } from "@/lib/auth";
import { fmtMoneyDual } from "@/lib/money";
import Link from "next/link";

export const dynamic = "force-dynamic";

// §9.11 spec: reports should drive decisions, not just count things. We
// prepend three "executive" cards before the legacy charts:
//   1. Weighted revenue forecast — same weights as the dashboard.
//   2. Funnel leakage — biggest drop-off stage so Lalit knows where to coach.
//   3. Stalled deal aging — money tied up in deals that haven't moved.
// Charts below stay for the people who still want raw numbers.

// Same weights used on the dashboard forecast so the numbers reconcile.
const FORECAST_WEIGHTS: Record<string, number> = {
  NEGOTIATION: 0.55,
  SITE_VISIT:  0.30,
  QUALIFIED:   0.10,
  CONTACTED:   0.02,
  NEW:         0.02,
};

// Threshold for "stalled" — days since the lead last changed stage. 7d
// chosen so the card shows a meaningful number on a small team; tune higher
// once the pipeline grows past ~200 active leads.
const STALLED_DAYS = 7;

export default async function ReportsPage() {
  const me = await requireUser();
  const isAdmin = me.role === "ADMIN";
  const today = startOfDay(new Date());

  const [
    bySource, agentPerf, callsByDay, funnel, topProjects,
    activeLeadsForForecast, stalledRaw,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, where: { createdAt: { gte: today } } }),

    prisma.user.findMany({
      where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
      include: {
        _count: { select: {
          callLogs: { where: { startedAt: { gte: today } } },
          ownedLeads: true,
        }},
      },
    }),

    prisma.$queryRaw<Array<{ d: string; total: number; connected: number }>>`
      SELECT to_char("startedAt"::date, 'YYYY-MM-DD') as d,
             COUNT(*)::int as total,
             SUM(CASE WHEN outcome::text = ${CallOutcome.CONNECTED} THEN 1 ELSE 0 END)::int as connected
      FROM "CallLog" WHERE "startedAt" >= (CURRENT_DATE - INTERVAL '13 days') GROUP BY "startedAt"::date ORDER BY "startedAt"::date ASC`,

    Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { status: { not: LeadStatus.NEW } } }),
      prisma.lead.count({ where: { status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION, LeadStatus.BOOKING_DONE, LeadStatus.WON] } } }),
      prisma.lead.count({ where: { status: { in: [LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION, LeadStatus.BOOKING_DONE, LeadStatus.WON] } } }),
      prisma.lead.count({ where: { status: { in: [LeadStatus.NEGOTIATION, LeadStatus.BOOKING_DONE, LeadStatus.WON] } } }),
      prisma.lead.count({ where: { status: { in: [LeadStatus.WON, LeadStatus.BOOKING_DONE] } } }),
    ]),

    prisma.project.findMany({
      include: { units: { include: { interestedBy: { include: { lead: true } } } } },
      take: 6,
    }),

    // ── Active pipeline rows for the weighted forecast.
    // Pull only the fields we need; budgetMin can be null for un-qualified
    // leads, those contribute 0 to the forecast.
    prisma.lead.findMany({
      where: { status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] } },
      select: { status: true, budgetMin: true, budgetCurrency: true },
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
    prisma.$queryRaw<Array<{ id: string; status: string; budget_min: number | null; currency: string | null; entered_at: Date }>>`
      WITH latest_change AS (
        SELECT DISTINCT ON ("leadId") "leadId", "createdAt"
        FROM "Activity"
        WHERE "type" = 'STATUS_CHANGE'
        ORDER BY "leadId", "createdAt" DESC
      )
      SELECT l."id" as id,
             l."status"::text as status,
             l."budgetMin" as budget_min,
             l."budgetCurrency" as currency,
             COALESCE(lc."createdAt", l."createdAt") as entered_at
      FROM "Lead" l
      LEFT JOIN latest_change lc ON lc."leadId" = l."id"
      WHERE l."status" IN ('QUALIFIED','SITE_VISIT','NEGOTIATION')
        AND COALESCE(lc."createdAt", l."createdAt") < NOW() - (${STALLED_DAYS} * INTERVAL '1 day')
    `,
  ]);

  const [tot, contacted, qualified, visit, neg] = funnel;

  // ── Compute decision metrics ───────────────────────────────────────
  // Weighted forecast — sum(budgetMin * weight per stage), split by currency
  // so AED and INR don't get incorrectly added together.
  let forecastAed = 0;
  let forecastInr = 0;
  for (const l of activeLeadsForForecast) {
    if (!l.budgetMin) continue;
    const w = FORECAST_WEIGHTS[l.status] ?? 0;
    const weighted = l.budgetMin * w;
    if (l.budgetCurrency === "INR") forecastInr += weighted;
    else forecastAed += weighted;
  }

  // Funnel leakage — find the biggest % drop between adjacent stages.
  // We re-use the existing funnel counts so the metric matches the chart.
  const funnelPairs: Array<{ from: string; to: string; lost: number; pct: number }> = [];
  const labels = [
    { from: "New",        to: "Contacted",    count: tot,       next: contacted },
    { from: "Contacted",  to: "Qualified",    count: contacted, next: qualified },
    { from: "Qualified",  to: "Site Visit",   count: qualified, next: visit },
    { from: "Site Visit", to: "Negotiation",  count: visit,     next: neg },
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

  const projectStats = topProjects.map(p => {
    const leadIds = new Set<string>();
    for (const u of p.units) for (const l of u.interestedBy) leadIds.add(l.leadId);
    const leads = leadIds.size;
    return { name: p.name, leads, bookings: Math.floor(leads / 12) };
  }).sort((a, b) => b.leads - a.leads);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Reports</h1>
        <p className="text-xs sm:text-sm text-gray-500">Decisions first · raw numbers below · live</p>
      </div>

      {/* §9.11 Decisions strip — lead with the three questions Lalit cares
          about: "How much money is coming?", "Where am I losing deals?",
          "What deals are stuck?". Each links to the underlying drill-down. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. WEIGHTED REVENUE FORECAST */}
        <Link href="/pipeline" className="card p-4 border-l-4 border-emerald-500 hover:shadow-lg transition active:bg-emerald-50">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">
            💰 Forecasted revenue
          </div>
          <div className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-1 leading-tight">
            {fmtMoneyDual({ aed: forecastAed, inr: forecastInr })}
          </div>
          <div className="text-[11px] text-emerald-700/70 mt-1">
            Weighted active pipeline · open pipeline-stage moves change this
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
        <Link href="/pipeline" className="card p-4 border-l-4 border-amber-500 hover:shadow-lg transition active:bg-amber-50">
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
            {([LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] as const).map((s) => {
              const x = stalledByStage[s];
              if (!x || x.count === 0) {
                return (
                  <div key={s} className="p-3 rounded-lg border bg-gray-50">
                    <div className="text-[11px] font-semibold text-gray-500">{s.replaceAll("_", " ")}</div>
                    <div className="text-lg font-bold text-gray-400 mt-1">0</div>
                  </div>
                );
              }
              return (
                <div key={s} className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <div className="text-[11px] font-semibold text-amber-900">{s.replaceAll("_", " ")}</div>
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

      {/* Primary report navigation — these are the everyday reports */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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
        <a href="#pipeline-overview" className="card p-4 border-l-4 border-[#c9a24b] hover:shadow-md transition active:bg-amber-50 block">
          <div className="text-2xl">📈</div>
          <div className="font-bold text-sm mt-1">Pipeline overview</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Funnel, source mix, agent performance · below ↓</div>
        </a>
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
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">DAILY · TODAY</div>
          <div className="font-semibold mt-1">Lead intake by source</div>
          <SourceBarChart data={bySource.map(b => ({ source: b.source, n: b._count._all }))} />
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">DAILY · TODAY</div>
          <div className="font-semibold mt-1">Agent productivity</div>
          <AgentBarChart data={agentPerf.map(u => ({ name: u.name.split(" ")[0], calls: u._count.callLogs, leads: u._count.ownedLeads }))} />
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-500 tracking-widest">LAST 14 DAYS</div>
          <div className="font-semibold mt-1">Call connect rate</div>
          <ConnectRateChart data={callsByDay.map(r => ({ d: r.d, rate: r.total ? Math.round((Number(r.connected) / Number(r.total)) * 100) : 0 }))} />
        </div>
      </div>

      <div id="funnel" className="grid grid-cols-1 lg:grid-cols-3 gap-4 scroll-mt-20">
        <div className="card p-5 lg:col-span-2">
          <div className="text-xs text-gray-500 tracking-widest">MONTHLY · ALL TIME</div>
          <div className="font-semibold mt-1">Conversion funnel</div>
          <FunnelChart data={[
            { stage: "Leads", n: tot },
            { stage: "Contacted", n: contacted },
            { stage: "Qualified", n: qualified },
            { stage: "Site Visit", n: visit },
            { stage: "Negotiation", n: neg },
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
          <div className="text-xs text-gray-500 tracking-widest">MONTHLY</div>
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
    </>
  );
}

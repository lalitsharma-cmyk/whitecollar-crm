import { prisma } from "@/lib/prisma";
import { LeadStatus, LeadSource, AIScore, CallOutcome, ActivityStatus } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import LeadsTrendChart from "@/components/charts/LeadsTrendChart";
import SourceMixChart from "@/components/charts/SourceMixChart";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import { runReconciler } from "@/lib/reconciler";
import { activityVisual } from "@/lib/activityIcon";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Sales forecast weights (matches your dashboard)
const WEIGHTS = { NEGOTIATION: 0.55, SITE_VISIT: 0.30, QUALIFIED: 0.10, CONTACTED: 0.02, NEW: 0.02 };

export default async function DashboardPage() {
  runReconciler().catch(() => {});
  const todayStart = startOfDay(new Date());

  const [
    totalClients, totalNotContacted, newToday, hotLeads,
    callsToday, connectedToday, waToday,
    followupsDueToday, followupsOverdue, readyToClose, needsYou,
    leadsBySource, recentActivities, upcoming, leadsLast14, sourceMix,
    salespersons, leadsByTeam, forecastLeads,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { status: LeadStatus.NEW } }),
    prisma.lead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { aiScore: AIScore.HOT } }),
    prisma.callLog.count({ where: { startedAt: { gte: todayStart } } }),
    prisma.callLog.count({ where: { startedAt: { gte: todayStart }, outcome: CallOutcome.CONNECTED } }),
    prisma.whatsAppMessage.count({ where: { receivedAt: { gte: todayStart } } }),
    prisma.activity.count({ where: { status: ActivityStatus.PLANNED, type: "CALL", scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600 * 1000) } } }),
    prisma.activity.count({ where: { status: ActivityStatus.PLANNED, scheduledAt: { lt: todayStart } } }),
    prisma.lead.count({ where: { status: { in: [LeadStatus.NEGOTIATION, LeadStatus.SITE_VISIT] } } }),
    prisma.lead.count({ where: { needsManagerReview: true, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, where: { createdAt: { gte: todayStart } } }),
    prisma.activity.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { lead: true, user: true } }),
    prisma.activity.findMany({ where: { status: ActivityStatus.PLANNED, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 5, include: { lead: true } }),
    prisma.$queryRaw<Array<{ d: string; n: number }>>`SELECT to_char("createdAt"::date, 'YYYY-MM-DD') as d, COUNT(*)::int as n FROM "Lead" WHERE "createdAt" >= (CURRENT_DATE - INTERVAL '13 days') GROUP BY "createdAt"::date ORDER BY "createdAt"::date ASC`,
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    // Per-salesperson stats today
    prisma.user.findMany({
      where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
      include: {
        _count: {
          select: {
            callLogs: { where: { startedAt: { gte: todayStart } } },
            ownedLeads: true,
          },
        },
      },
    }),
    // By-team breakdown
    prisma.lead.groupBy({ by: ["forwardedTeam"], _count: { _all: true } }),
    // Forecast: all open deals with budgetMin
    prisma.lead.findMany({
      where: { status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] }, budgetMin: { not: null } },
      select: { status: true, budgetMin: true, budgetMax: true, budgetCurrency: true },
    }),
  ]);

  const connectRate = callsToday ? Math.round((connectedToday / callsToday) * 100) : 0;

  // Forecast computation — weighted by stage
  const forecast = { aed: { closing: 0, meeting: 0, moving: 0, early: 0 }, inr: { closing: 0, meeting: 0, moving: 0, early: 0 } };
  for (const l of forecastLeads) {
    const v = l.budgetMin ?? 0;
    const cur = l.budgetCurrency === "INR" ? "inr" : "aed";
    if (l.status === "NEGOTIATION") forecast[cur].closing += v * WEIGHTS.NEGOTIATION;
    else if (l.status === "SITE_VISIT") forecast[cur].meeting += v * WEIGHTS.SITE_VISIT;
    else if (l.status === "QUALIFIED") forecast[cur].moving += v * WEIGHTS.QUALIFIED;
    else forecast[cur].early += v * (l.status === "CONTACTED" ? WEIGHTS.CONTACTED : WEIGHTS.NEW);
  }
  const fcTotal = (cur: "aed" | "inr") => forecast[cur].closing + forecast[cur].meeting + forecast[cur].moving + forecast[cur].early;

  // Per-salesperson with closeable + needsYou counts
  const spStats = await Promise.all(
    salespersons.map(async (u) => {
      const [connected, dueToday, overdue, closeable, needs] = await Promise.all([
        prisma.callLog.count({ where: { userId: u.id, startedAt: { gte: todayStart }, outcome: CallOutcome.CONNECTED } }),
        prisma.activity.count({ where: { userId: u.id, status: ActivityStatus.PLANNED, scheduledAt: { gte: todayStart, lt: new Date(todayStart.getTime() + 24 * 3600 * 1000) } } }),
        prisma.activity.count({ where: { userId: u.id, status: ActivityStatus.PLANNED, scheduledAt: { lt: todayStart } } }),
        prisma.lead.count({ where: { ownerId: u.id, status: { in: [LeadStatus.NEGOTIATION, LeadStatus.SITE_VISIT] } } }),
        prisma.lead.count({ where: { ownerId: u.id, needsManagerReview: true } }),
      ]);
      return { id: u.id, name: u.name, team: u.team, calls: u._count.callLogs, connected, dueToday, overdue, closeable, needs, clients: u._count.ownedLeads };
    })
  );
  spStats.sort((a, b) => b.calls - a.calls);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Command Center</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Live data</p>
        </div>
        <Link href="/action-list" className="btn btn-gold">📋 Open Action List</Link>
      </div>

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

      {/* Weighted Sales Forecast */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">SALES FORECAST (WEIGHTED)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <ForecastCard label="EXPECTED THIS MONTH" sub="2 deals at closing stage" aed={forecast.aed.closing} inr={forecast.inr.closing} color="border-emerald-500" />
          <ForecastCard label="EXPECTED IN 1-3 MONTHS" sub="deals actively moving" aed={forecast.aed.meeting + forecast.aed.moving} inr={forecast.inr.meeting + forecast.inr.moving} color="border-amber-500" />
          <ForecastCard label="LONGER-TERM POTENTIAL" sub="early or cold leads" aed={forecast.aed.early} inr={forecast.inr.early} color="border-blue-500" />
          <ForecastCard label="TOTAL WEIGHTED FORECAST" sub="all stages combined" aed={fcTotal("aed")} inr={fcTotal("inr")} color="border-[#c9a24b]" />
        </div>
        <p className="text-xs text-gray-500 mt-2">Each deal is weighted by likelihood: closing 55%, meeting 30%, actively moving 10%, early/cold 2%. Adjust in <code>WEIGHTS</code> if needed.</p>
      </div>

      {/* By Salesperson table */}
      <div className="card p-3 lg:p-5 overflow-x-auto">
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-3">BY SALESPERSON</div>
        <table className="tbl w-full min-w-[640px]">
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

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="font-semibold mb-3">Leads over time · Last 14 days</div>
          <LeadsTrendChart data={leadsLast14.map((r) => ({ d: r.d, n: Number(r.n) }))} />
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Source Mix</div>
          <SourceMixChart data={sourceMix.map((r) => ({ source: r.source, n: r._count._all }))} />
        </div>
      </div>

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
                  <div className="text-xs text-gray-500">{a.scheduledAt && new Date(a.scheduledAt).toLocaleString()}</div>
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
      <div className="text-[9px] lg:text-[10px] tracking-widest text-gray-500 uppercase mt-0.5 lg:mt-1 leading-tight">{title}</div>
      <div className="text-[10px] lg:text-xs text-gray-500 mt-0.5 lg:mt-1 leading-tight">{sub}</div>
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

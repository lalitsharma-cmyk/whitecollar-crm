import { prisma } from "@/lib/prisma";
import { LeadStatus, LeadSource, AIScore, CallOutcome, ActivityStatus } from "@prisma/client";
import { formatDistanceToNow, startOfDay } from "date-fns";
import LeadsTrendChart from "@/components/charts/LeadsTrendChart";
import SourceMixChart from "@/components/charts/SourceMixChart";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const todayStart = startOfDay(new Date());

  const [
    totalLeads, newToday, hotLeads, callsToday, connectedCallsToday,
    leadsBySource, recentActivities, upcoming, leadsLast14, sourceMix, leaderboard,
    pipelineDubai, pipelineIndia,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.lead.count({ where: { aiScore: AIScore.HOT } }),
    prisma.callLog.count({ where: { startedAt: { gte: todayStart } } }),
    prisma.callLog.count({ where: { startedAt: { gte: todayStart }, outcome: CallOutcome.CONNECTED } }),
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true }, where: { createdAt: { gte: todayStart } } }),
    prisma.activity.findMany({ orderBy: { createdAt: "desc" }, take: 6, include: { lead: true, user: true } }),
    prisma.activity.findMany({ where: { status: ActivityStatus.PLANNED, scheduledAt: { gte: new Date() } }, orderBy: { scheduledAt: "asc" }, take: 5, include: { lead: true } }),
    prisma.$queryRaw<Array<{ d: string; n: number }>>`SELECT to_char("createdAt"::date, 'YYYY-MM-DD') as d, COUNT(*)::int as n FROM "Lead" WHERE "createdAt" >= (CURRENT_DATE - INTERVAL '13 days') GROUP BY "createdAt"::date ORDER BY "createdAt"::date ASC`,
    prisma.lead.groupBy({ by: ["source"], _count: { _all: true } }),
    prisma.user.findMany({
      where: { active: true, role: { not: "ADMIN" } },
      include: { _count: { select: { callLogs: { where: { startedAt: { gte: todayStart } } }, ownedLeads: true } } },
      take: 5,
    }),
    // Pipeline value split by currency
    prisma.lead.aggregate({ _sum: { budgetMin: true }, where: { budgetCurrency: "AED", status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] } } }),
    prisma.lead.aggregate({ _sum: { budgetMin: true }, where: { budgetCurrency: "INR", status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] } } }),
  ]);

  const connectRate = callsToday ? Math.round((connectedCallsToday / callsToday) * 100) : 0;
  const sortedLb = [...leaderboard].sort((a, b) => b._count.callLogs - a._count.callLogs);
  const aedSum = pipelineDubai._sum.budgetMin ?? 0;
  const inrSum = pipelineIndia._sum.budgetMin ?? 0;

  // Lead-by-source map for today
  const srcMap = new Map(leadsBySource.map((r) => [r.source, r._count._all]));
  const srcLine = `${srcMap.get(LeadSource.WHATSAPP) ?? 0} WhatsApp · ${srcMap.get(LeadSource.WEBSITE) ?? 0} Website · ${srcMap.get(LeadSource.CSV_IMPORT) ?? 0} CSV · ${srcMap.get(LeadSource.EVENT) ?? 0} Events`;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Command Center</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · Live data · Dubai (AED) + India (₹)</p>
        </div>
        <div className="seg">
          <button className="on">Today</button>
          <button>Week</button>
          <button>Month</button>
          <button>Quarter</button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card kpi">
          <div className="text-xs text-gray-500">New Leads Today</div>
          <div className="text-3xl font-bold mt-1">{newToday}</div>
          <div className="mt-2 text-xs text-gray-500">{srcLine}</div>
        </div>
        <div className="card kpi">
          <div className="text-xs text-gray-500">Hot Leads</div>
          <div className="text-3xl font-bold mt-1">{hotLeads}</div>
          <div className="mt-2"><span className="chip chip-hot">AI scored</span></div>
        </div>
        <div className="card kpi">
          <div className="text-xs text-gray-500">Connected Calls Today</div>
          <div className="text-3xl font-bold mt-1">{connectedCallsToday} <span className="text-base text-gray-400 font-normal">/ {callsToday}</span></div>
          <div className="mt-2 text-xs text-[#16a34a] font-semibold">{connectRate}% connect rate</div>
        </div>
        <div className="card kpi grad-card">
          <div className="text-xs text-white/70">Pipeline Value</div>
          <div className="text-sm font-bold mt-1 leading-tight">
            <div>{fmtMoney(aedSum, "AED")} <span className="text-[10px] text-white/60 font-normal">· Dubai</span></div>
            <div>{fmtMoney(inrSum, "INR")} <span className="text-[10px] text-white/60 font-normal">· India</span></div>
          </div>
          <div className="mt-2 text-xs text-white/70">Qualified → Negotiation</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-semibold">Leads over time</div>
              <div className="text-xs text-gray-500">Last 14 days · live</div>
            </div>
          </div>
          <LeadsTrendChart data={leadsLast14.map((r) => ({ d: r.d, n: Number(r.n) }))} />
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Source Mix · All Time</div>
          <SourceMixChart data={sourceMix.map((r) => ({ source: r.source, n: r._count._all }))} />
        </div>
      </div>

      {/* AI briefing + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="font-semibold">AI Daily Briefing</div>
            <span className="ai-tag">AI</span>
          </div>
          <ul className="space-y-3 text-sm">
            <li className="flex gap-3"><span className="dot bg-[#ef4444]"></span><div><b>{hotLeads} hot leads</b> in your pipeline. Prioritise the {Math.min(3, hotLeads)} idle for &gt;48h.</div></li>
            <li className="flex gap-3"><span className="dot bg-[#c9a24b]"></span><div><b>Today's connect rate is {connectRate}%</b> across {callsToday} calls.</div></li>
            <li className="flex gap-3"><span className="dot bg-[#16a34a]"></span><div><b>Pipeline:</b> {fmtMoneyDual({ aed: aedSum, inr: inrSum })} of open deals in Qualified → Negotiation.</div></li>
            <li className="flex gap-3"><span className="dot bg-[#3b82f6]"></span><div><b>Connect with your AI provider</b> (Settings → AI) to enable smarter insights and lead summaries.</div></li>
          </ul>
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Agent Leaderboard · Today</div>
          <div className="space-y-3">
            {sortedLb.map((u) => (
              <div key={u.id} className="flex items-center gap-3">
                <div className={`avatar ${u.avatarColor ?? "bg-slate-500"}`}>{u.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}</div>
                <div className="flex-1">
                  <div className="text-sm font-semibold">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.team ?? "—"} · {u._count.callLogs} calls today · {u._count.ownedLeads} leads</div>
                </div>
                <div className="text-sm font-bold">{u._count.callLogs}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity + Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="font-semibold mb-3">Recent activity</div>
          <div className="tl-line space-y-3">
            {recentActivities.map((a) => (
              <div key={a.id} className="relative">
                <span className="tl-dot"></span>
                <div className="text-sm">
                  <b>{a.user?.name ?? "System"}</b> · {a.title}
                  {a.lead && <> on <b>{a.lead.name}</b></>}
                </div>
                <div className="text-xs text-gray-500">{formatDistanceToNow(a.createdAt, { addSuffix: true })}</div>
              </div>
            ))}
            {recentActivities.length === 0 && <div className="text-sm text-gray-500">No activity yet.</div>}
          </div>
        </div>
        <div className="card p-5">
          <div className="font-semibold mb-3">Upcoming follow-ups</div>
          <div className="space-y-2">
            {upcoming.map((a) => (
              <div key={a.id} className="flex items-center justify-between p-3 rounded-lg border border-[#e5e7eb]">
                <div>
                  <div className="text-sm font-semibold">{a.title}{a.lead && <> · {a.lead.name}</>}</div>
                  <div className="text-xs text-gray-500">{a.scheduledAt && new Date(a.scheduledAt).toLocaleString()}</div>
                </div>
                <span className="chip chip-new">{a.type}</span>
              </div>
            ))}
            {upcoming.length === 0 && <div className="text-sm text-gray-500">Nothing scheduled. Plan your next call!</div>}
          </div>
        </div>
      </div>
    </>
  );
}

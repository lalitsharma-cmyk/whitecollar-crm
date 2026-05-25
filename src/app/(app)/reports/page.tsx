import { prisma } from "@/lib/prisma";
import { LeadStatus, CallOutcome } from "@prisma/client";
import { startOfDay, subDays } from "date-fns";
import SourceBarChart from "@/components/charts/SourceBarChart";
import AgentBarChart from "@/components/charts/AgentBarChart";
import ConnectRateChart from "@/components/charts/ConnectRateChart";
import FunnelChart from "@/components/charts/FunnelChart";
import { requireUser } from "@/lib/auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const me = await requireUser();
  const isAdmin = me.role === "ADMIN";
  const today = startOfDay(new Date());

  const [bySource, agentPerf, callsByDay, funnel, topProjects] = await Promise.all([
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
  ]);

  const [tot, contacted, qualified, visit, neg, won] = funnel;

  const projectStats = topProjects.map(p => {
    const leadIds = new Set<string>();
    for (const u of p.units) for (const l of u.interestedBy) leadIds.add(l.leadId);
    const leads = leadIds.size;
    const visits = [...leadIds].length; // simplified: every interested lead counts toward visits potentialy
    return { name: p.name, leads, visits, bookings: Math.floor(leads / 12) };
  }).sort((a, b) => b.leads - a.leads);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Reports</h1>
        <p className="text-xs sm:text-sm text-gray-500">Live · auto-refresh on every page load</p>
      </div>

      {/* Primary report navigation — these are the everyday reports */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <div className="card p-4 border-l-4 border-[#c9a24b]">
          <div className="text-2xl">📈</div>
          <div className="font-bold text-sm mt-1">Pipeline overview</div>
          <div className="text-[10px] text-gray-500 mt-0.5">Funnel, source mix, agent performance · below ↓</div>
        </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5 lg:col-span-2">
          <div className="text-xs text-gray-500 tracking-widest">MONTHLY · ALL TIME</div>
          <div className="font-semibold mt-1">Conversion funnel</div>
          <FunnelChart data={[
            { stage: "Leads", n: tot },
            { stage: "Contacted", n: contacted },
            { stage: "Qualified", n: qualified },
            { stage: "Site Visit", n: visit },
            { stage: "Negotiation", n: neg },
            { stage: "Won", n: won },
          ]} />
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

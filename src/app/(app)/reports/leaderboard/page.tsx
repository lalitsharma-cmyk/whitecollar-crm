import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { LeadStatus, Role } from "@prisma/client";
import { subDays, startOfDay } from "date-fns";
import Link from "next/link";

const AGENT_ROLES: Role[] = [Role.AGENT, Role.MANAGER];

export const dynamic = "force-dynamic";

const QUALIFIED_STATUSES: LeadStatus[] = [
  LeadStatus.QUALIFIED,
  LeadStatus.SITE_VISIT,
  LeadStatus.NEGOTIATION,
  LeadStatus.EOI,
  LeadStatus.BOOKING_DONE,
  LeadStatus.WON,
];

const MEDAL = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const me = await requireUser();
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;

  // Date range: last 30 days
  const rangeEnd = new Date();
  const rangeStart = startOfDay(subDays(rangeEnd, 30));

  // Agent scope
  const agentWhere =
    me.role === "ADMIN"
      ? { role: { in: AGENT_ROLES }, active: true }
      : me.role === "MANAGER" && managerTeam
      ? { role: { in: AGENT_ROLES }, active: true, team: managerTeam }
      : { id: me.id };

  const agents = await prisma.user.findMany({
    where: agentWhere,
    select: { id: true, name: true, team: true },
    orderBy: { name: "asc" },
  });

  if (agents.length === 0) {
    return (
      <>
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">🏆 Agent Leaderboard</h1>
        </div>
        <div className="card p-6 text-gray-500">No agents found.</div>
      </>
    );
  }

  const agentIds = agents.map((a) => a.id);

  // Fetch all counts in parallel
  const [callCounts, leadCounts, qualifiedCounts, wonCounts] = await Promise.all([
    // Calls made in last 30 days per agent
    prisma.callLog.groupBy({
      by: ["userId"],
      where: {
        userId: { in: agentIds },
        startedAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
    }),

    // Leads assigned per agent (all time — scoped to visible team)
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: { ownerId: { in: agentIds } },
      _count: { _all: true },
    }),

    // Leads qualified+ per agent
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        ownerId: { in: agentIds },
        status: { in: QUALIFIED_STATUSES },
      },
      _count: { _all: true },
    }),

    // Leads won per agent
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        ownerId: { in: agentIds },
        status: LeadStatus.WON,
      },
      _count: { _all: true },
    }),
  ]);

  // Index by userId / ownerId
  const callMap = new Map(callCounts.map((r) => [r.userId, r._count._all]));
  const leadMap = new Map(leadCounts.map((r) => [r.ownerId as string, r._count._all]));
  const qualMap = new Map(qualifiedCounts.map((r) => [r.ownerId as string, r._count._all]));
  const wonMap = new Map(wonCounts.map((r) => [r.ownerId as string, r._count._all]));

  interface AgentRow {
    id: string;
    name: string;
    team: string | null;
    callsMade: number;
    leadsAssigned: number;
    leadsQualified: number;
    won: number;
    conversionRate: number;
  }

  const rows: AgentRow[] = agents.map((a) => {
    const callsMade = callMap.get(a.id) ?? 0;
    const leadsAssigned = leadMap.get(a.id) ?? 0;
    const leadsQualified = qualMap.get(a.id) ?? 0;
    const won = wonMap.get(a.id) ?? 0;
    const conversionRate = leadsAssigned > 0 ? (won / leadsAssigned) * 100 : 0;
    return {
      id: a.id,
      name: a.name,
      team: a.team ?? null,
      callsMade,
      leadsAssigned,
      leadsQualified,
      won,
      conversionRate,
    };
  });

  // Sort by callsMade descending
  rows.sort((a, b) => b.callsMade - a.callsMade);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">🏆 Agent Leaderboard</h1>
          <p className="text-xs sm:text-sm text-gray-500">Last 30 days</p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[520px]">
          <thead>
            <tr>
              <th className="text-center">Rank</th>
              <th>Agent Name</th>
              <th>Team</th>
              <th className="text-center">Calls Made</th>
              <th className="text-center">Leads Assigned</th>
              <th className="text-center">Qualified</th>
              <th className="text-center">Won</th>
              <th className="text-center">Conversion %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const rankLabel = MEDAL[idx] ? `${MEDAL[idx]} ${idx + 1}` : String(idx + 1);
              const convPct = row.conversionRate.toFixed(1);
              const isTop = idx < 3;
              return (
                <tr key={row.id} className={isTop ? "bg-amber-50" : undefined}>
                  <td className="text-center font-bold text-sm">{rankLabel}</td>
                  <td className="font-semibold text-sm">{row.name}</td>
                  <td className="text-sm text-gray-600">{row.team ?? "—"}</td>
                  <td className="text-center text-sm font-bold">{row.callsMade}</td>
                  <td className="text-center text-sm">{row.leadsAssigned}</td>
                  <td className="text-center text-sm">{row.leadsQualified}</td>
                  <td className="text-center text-sm font-semibold text-emerald-700">{row.won}</td>
                  <td className={`text-center text-sm font-semibold ${row.conversionRate >= 20 ? "text-emerald-700" : row.conversionRate >= 10 ? "text-amber-700" : "text-gray-500"}`}>
                    {convPct}%
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-6">No data yet</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="text-[10px] text-gray-500 p-3">
          Calls Made = last 30 days. Leads Assigned, Qualified, Won = all time for this scope.
          Conversion % = Won ÷ Leads Assigned × 100.
        </div>
      </div>
    </>
  );
}

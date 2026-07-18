import { Fragment } from "react";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { Role } from "@prisma/client";
import { CLOSING_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";
import { activeLeadWhere, ACTIVE_ORIGIN_WHERE } from "@/lib/leadScope";
import { subDays, startOfDay, format } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";
import { leadSourceModule, type SourceModule } from "@/lib/moduleSource";
import { ModuleBreakdownDetails, type ModuleBreakdownRow } from "@/components/ModuleBreakdown";
import { BUYER_CALL_ACTIVITY_TYPES } from "@/lib/dashboardWidgets";
import { excludePendingCallsWhere } from "@/lib/ghosting";

const AGENT_ROLES: Role[] = [Role.AGENT, Role.MANAGER];

export const dynamic = "force-dynamic";

// Closing-type statuses (status-only, no stages)
const QUALIFIED_STATUSES = CLOSING_STATUSES;

const MEDAL = ["🥇", "🥈", "🥉"];

export default async function LeaderboardPage() {
  const me = await requireUser();

  // Leaderboard is team data — agents see only their own performance elsewhere.
  if (me.role === "AGENT") redirect("/dashboard");

  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;

  // Date range: last 90 days (was 30 — extended so historical call data shows up)
  const rangeEnd = new Date();
  const rangeStart = startOfDay(subDays(rangeEnd, 90));

  // Agent scope — hrOnly:false keeps HR/non-sales users (e.g. Nisha) off the
  // leaderboard; driven off the canonical hrOnly flag, not a name.
  const agentWhere =
    me.role === "ADMIN"
      ? { role: { in: AGENT_ROLES }, active: true, hrOnly: false }
      : me.role === "MANAGER" && managerTeam
      ? { role: { in: AGENT_ROLES }, active: true, hrOnly: false, team: managerTeam }
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
  const [callCounts, buyerCallCounts, leadCounts, qualifiedCounts, wonCounts] = await Promise.all([
    // Calls made in last 90 days per agent (LEAD + unlinked calls). buyerId:null
    // EXCLUDES buyer-telephony CallLog rows so buyer calls are counted ONCE — from
    // the BuyerActivity ledger below (buyerCallCounts), never from CallLog. This
    // CallLog query has no lead filter, so the buyerId:null guard is required.
    // excludePendingCallsWhere() drops unresolved dials (INITIATED / RINGING):
    // the row is written the instant "Call" is tapped, so without it the ranking
    // (rows sort by callsMade) would reward taps instead of resolved calls.
    prisma.callLog.groupBy({
      by: ["userId"],
      where: {
        ...excludePendingCallsWhere(),
        userId: { in: agentIds },
        buyerId: null,
        startedAt: { gte: rangeStart, lte: rangeEnd },
      },
      _count: { _all: true },
    }),

    // Buyer-Data calls per agent — sourced from BuyerActivity ONLY (manual + mirrored
    // telephony), so each buyer call counts once. Same window as the CallLog query
    // (startedAt gte/lte → createdAt gte/lte) and same per-agent userId scope; live
    // buyers only (buyer.deletedAt:null). Folded into callsMade so the leaderboard
    // ranks by TOTAL calls (lead + buyer). (Lalit 2026-07-08)
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: {
        userId: { in: agentIds },
        type: { in: BUYER_CALL_ACTIVITY_TYPES },
        createdAt: { gte: rangeStart, lte: rangeEnd },
        buyer: { deletedAt: null },
      },
      _count: { _all: true },
    }),

    // Active leads per agent (CANONICAL activeLeadWhere — ACTIVE_LEAD origin,
    // non-deleted, non-terminal status). Identical to /reports, /team,
    // /reports/agent-performance, /profile, /team/[id] for the same agent.
    // leadOrigin + isColdCall added to the `by` so the same population also
    // yields the canonical 3-way module split (leadSourceModule). The flat
    // per-agent total is the sum over its combo rows → total == Leads + Master
    // Data + Revival by construction.
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: activeLeadWhere({ ownerId: { in: agentIds } }),
      _count: { _all: true },
    }),

    // Leads qualified+ per agent (ACTIVE-origin book; own status filter)
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: {
        ownerId: { in: agentIds },
        deletedAt: null,
        ...ACTIVE_ORIGIN_WHERE,
        currentStatus: { in: QUALIFIED_STATUSES },
      },
      _count: { _all: true },
    }),

    // Leads won per agent (ACTIVE-origin book; booked status)
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: {
        ownerId: { in: agentIds },
        deletedAt: null,
        ...ACTIVE_ORIGIN_WHERE,
        currentStatus: { in: BOOKED_STATUSES },
      },
      _count: { _all: true },
    }),
  ]);

  // Index by userId / ownerId. The three lead metrics fold their [ownerId,
  // leadOrigin, isColdCall] combo rows into (a) a flat per-agent total and
  // (b) a per-agent per-module triple. zeroTriple() covers the 3 lead modules
  // (buyer modules stay 0 — buyers are a separate report).
  const callMap = new Map(callCounts.map((r) => [r.userId, r._count._all]));
  // Buyer-Data calls per agent (userId is nullable on BuyerActivity — skip null rows,
  // they're system/imported and out of the agentIds scope anyway).
  const buyerCallMap = new Map(
    buyerCallCounts.filter((r) => r.userId != null).map((r) => [r.userId as string, r._count._all]),
  );
  type Triple = Record<SourceModule, number>;
  const zeroTriple = (): Triple => ({ "Leads": 0, "Master Data": 0, "Revival Engine": 0, "Dubai Buyer Data": 0, "India Buyer Data": 0 });
  const leadMap = new Map<string, number>();
  const qualMap = new Map<string, number>();
  const wonMap = new Map<string, number>();
  const leadSplit = new Map<string, Triple>();
  const qualSplit = new Map<string, Triple>();
  const wonSplit = new Map<string, Triple>();
  function foldSplit(
    rows: Array<{ ownerId: string | null; leadOrigin: string | null; isColdCall: boolean | null; _count: { _all: number } }>,
    flat: Map<string, number>,
    split: Map<string, Triple>,
  ) {
    for (const r of rows) {
      if (!r.ownerId) continue;
      const n = r._count._all;
      flat.set(r.ownerId, (flat.get(r.ownerId) ?? 0) + n);
      const t = split.get(r.ownerId) ?? zeroTriple();
      t[leadSourceModule(r.leadOrigin, r.isColdCall)] += n;
      split.set(r.ownerId, t);
    }
  }
  foldSplit(leadCounts, leadMap, leadSplit);
  foldSplit(qualifiedCounts, qualMap, qualSplit);
  foldSplit(wonCounts, wonMap, wonSplit);

  interface AgentRow {
    id: string;
    name: string;
    team: string | null;
    callsMade: number;
    leadsAssigned: number;
    leadsQualified: number;
    won: number;
    conversionRate: number;
    // Per-module (Leads · Master Data · Revival) split of the 3 lead metrics.
    activeSplit: Triple;
    qualifiedSplit: Triple;
    wonSplit: Triple;
  }

  const rows: AgentRow[] = agents.map((a) => {
    // Total calls = lead/unlinked (CallLog, buyerId:null) + Buyer-Data (BuyerActivity).
    const callsMade = (callMap.get(a.id) ?? 0) + (buyerCallMap.get(a.id) ?? 0);
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
      activeSplit: leadSplit.get(a.id) ?? zeroTriple(),
      qualifiedSplit: qualSplit.get(a.id) ?? zeroTriple(),
      wonSplit: wonSplit.get(a.id) ?? zeroTriple(),
    };
  });

  // Sort by callsMade descending
  rows.sort((a, b) => b.callsMade - a.callsMade);

  const allZeroCalls = rows.every((r) => r.callsMade === 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">🏆 Agent Leaderboard</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Last 90 days · {format(rangeStart, "d MMM yyyy")} – {format(rangeEnd, "d MMM yyyy")}
          </p>
        </div>
      </div>

      {allZeroCalls && (
        <div className="card p-4 bg-amber-50 border-l-4 border-amber-400 text-sm text-amber-800">
          No calls logged in the last 90 days. Call data from earlier periods is available in{" "}
          <Link href="/reports/activity" className="underline font-medium">Reports → Activity</Link>.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[520px]">
          <thead>
            <tr>
              <th className="text-center">Rank</th>
              <th>Agent Name</th>
              <th>Team</th>
              <th className="text-center">Calls Made</th>
              <th className="text-center">Active Leads</th>
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
              // Additive per-module split of this agent's 3 lead metrics.
              const breakdownRows: ModuleBreakdownRow[] = [
                { label: "Active Leads", counts: row.activeSplit, total: row.leadsAssigned },
                { label: "Qualified", counts: row.qualifiedSplit, total: row.leadsQualified },
                { label: "Won", counts: row.wonSplit, total: row.won },
              ];
              const hasSplit = row.leadsAssigned + row.leadsQualified + row.won > 0;
              return (
                <Fragment key={row.id}>
                  <tr className={isTop ? "bg-amber-50" : undefined}>
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
                  {hasSplit && (
                    <tr className={isTop ? "bg-amber-50/60" : "bg-gray-50/60"}>
                      <td className="px-3 py-0" colSpan={8}>
                        <ModuleBreakdownDetails rows={breakdownRows} />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
          Calls Made = last 90 days. Active Leads (canonical: live, non-cold, non-terminal),
          Qualified, Won = all time for this scope. Conversion % = Won ÷ Active Leads × 100.
          Expand any agent to see the lead-metric split across <strong>Leads · Master Data · Revival Engine</strong> — every total = Leads + Master Data + Revival.
        </div>
      </div>
    </>
  );
}

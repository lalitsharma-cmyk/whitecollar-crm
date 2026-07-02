// Follow-up Compliance report (FU-4). Per-agent: overdue follow-ups, due-today,
// and "chronically rolled" leads (auto-advanced ≥3× by the nightly rollover =
// an agent quietly postponing). Manager/Admin only — an AGENT is redirected to
// /reports (they must not see other agents' data). MANAGER is locked to their
// team; ADMIN sees all (optional ?team= filter). Read-only; no data mutated.

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { normalizeTeam } from "@/lib/teamRouting";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const ROLLED_CHRONIC = 3; // ≥3 nightly rollovers = chronic postponement

function istTodayBounds() {
  const IST = 330 * 60_000;
  const istMid = new Date(Date.now() + IST);
  istMid.setUTCHours(0, 0, 0, 0);
  const start = new Date(istMid.getTime() - IST);
  return { start, end: new Date(start.getTime() + 24 * 3600_000) };
}

export default async function FollowupCompliancePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/reports"); // team compliance = manager/admin only
  const sp = await searchParams;
  const { start, end } = istTodayBounds();

  const resolvedTeam: "India" | "Dubai" | "all" =
    me.role === "MANAGER" ? (normalizeTeam(me.team) ?? "all")
    : (sp.team === "India" || sp.team === "Dubai") ? sp.team : "all";
  const teamWhere = resolvedTeam === "all" ? {} : { forwardedTeam: resolvedTeam };

  const agents = await prisma.user.findMany({
    where: {
      active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] },
      ...(resolvedTeam === "all" ? {} : { team: resolvedTeam }),
    },
    select: { id: true, name: true, team: true },
    orderBy: { name: "asc" },
  });
  const agentIds = agents.map((a) => a.id);
  const liveWhere = {
    deletedAt: null, currentStatus: { notIn: TERMINAL_STATUSES },
    ownerId: { in: agentIds }, ...teamWhere,
  };

  const [overdueGroups, todayGroups, rolloverGroups] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerId"], _count: { _all: true },
      where: { ...liveWhere, followupDate: { not: null, lt: start } } }),
    prisma.lead.groupBy({ by: ["ownerId"], _count: { _all: true },
      where: { ...liveWhere, followupDate: { gte: start, lt: end } } }),
    prisma.leadFieldHistory.groupBy({ by: ["leadId"], _count: { _all: true },
      where: { field: "followupDate", source: "system-rollover" } }),
  ]);

  // Chronically-rolled leads (≥3 rollovers) → map to their owner.
  const chronicLeadIds = rolloverGroups
    .filter((g) => g._count._all >= ROLLED_CHRONIC)
    .map((g) => g.leadId)
    .filter((x): x is string => !!x);
  const chronicLeads = chronicLeadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: chronicLeadIds }, ownerId: { in: agentIds }, deletedAt: null,
          currentStatus: { notIn: TERMINAL_STATUSES } },
        select: { ownerId: true },
      })
    : [];

  const overdueBy = new Map(overdueGroups.map((g) => [g.ownerId, g._count._all]));
  const todayBy = new Map(todayGroups.map((g) => [g.ownerId, g._count._all]));
  const chronicBy = new Map<string, number>();
  for (const l of chronicLeads) if (l.ownerId) chronicBy.set(l.ownerId, (chronicBy.get(l.ownerId) ?? 0) + 1);

  const rows = agents
    .map((a) => ({
      id: a.id, name: a.name, team: a.team,
      overdue: overdueBy.get(a.id) ?? 0,
      today: todayBy.get(a.id) ?? 0,
      chronic: chronicBy.get(a.id) ?? 0,
    }))
    .filter((r) => r.overdue > 0 || r.today > 0 || r.chronic > 0)
    .sort((x, y) => y.overdue - x.overdue || y.chronic - x.chronic || y.today - x.today);

  const tot = rows.reduce((a, r) => ({ overdue: a.overdue + r.overdue, today: a.today + r.today, chronic: a.chronic + r.chronic }),
    { overdue: 0, today: 0, chronic: 0 });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">⏰ Follow-up Compliance</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Per-agent overdue · due today · chronically-rolled (auto-postponed ≥{ROLLED_CHRONIC}×)
            {resolvedTeam !== "all" && <span className="ml-1">· {resolvedTeam} team</span>}
          </p>
        </div>
        {me.role === "ADMIN" && (
          <div className="seg self-start sm:self-auto">
            <Link href="/reports/followup-compliance?team=Dubai" className={resolvedTeam === "Dubai" ? "on" : ""}>🇦🇪 Dubai</Link>
            <Link href="/reports/followup-compliance?team=India" className={resolvedTeam === "India" ? "on" : ""}>🇮🇳 India</Link>
            <Link href="/reports/followup-compliance" className={resolvedTeam === "all" ? "on" : ""}>All</Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-red-500">
          <div className="text-[10px] uppercase tracking-widest text-red-700 font-bold">Overdue</div>
          <div className="text-2xl font-extrabold text-red-800 mt-1">{tot.overdue}</div>
        </div>
        <div className="card p-4 border-l-4 border-amber-500">
          <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">Due today</div>
          <div className="text-2xl font-extrabold text-amber-800 mt-1">{tot.today}</div>
        </div>
        <div className="card p-4 border-l-4 border-violet-500">
          <div className="text-[10px] uppercase tracking-widest text-violet-700 font-bold">Chronically rolled</div>
          <div className="text-2xl font-extrabold text-violet-800 mt-1">{tot.chronic}</div>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2.5 px-3">Agent</th>
              <th className="text-center px-2">Overdue</th>
              <th className="text-center px-2">Due today</th>
              <th className="text-center px-2">⟳ Chronic</th>
              <th className="text-right px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-gray-500">✅ No overdue or chronically-postponed follow-ups. Clean board.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-medium">{r.name}{r.team && <span className="ml-1.5 text-[10px] text-gray-400">{r.team}</span>}</td>
                <td className="text-center px-2">{r.overdue > 0 ? <span className="font-bold text-red-700">{r.overdue}</span> : <span className="text-gray-300">0</span>}</td>
                <td className="text-center px-2">{r.today > 0 ? <span className="font-semibold text-amber-700">{r.today}</span> : <span className="text-gray-300">0</span>}</td>
                <td className="text-center px-2">{r.chronic > 0 ? <span className="font-semibold text-violet-700">⟳ {r.chronic}</span> : <span className="text-gray-300">0</span>}</td>
                <td className="text-right px-3">
                  <Link href={`/leads?owner=${r.id}&when=overdue`} className="text-[11px] text-blue-600 hover:underline">View →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-gray-400">
        Overdue = follow-up date before today (IST) on a live lead. Chronic = a lead the nightly rollover auto-advanced ≥{ROLLED_CHRONIC}× (agent keeps postponing). Read-only.
      </p>
    </>
  );
}

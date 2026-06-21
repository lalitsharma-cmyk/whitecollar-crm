// /admin/quality — sortable Quality Score table across all eligible agents.
// ADMIN + MANAGER only. Manager view omits the Wellbeing column (per spec §4
// privacy line: wellbeing is private to the agent themselves).
//
// Filterable by team and by window (Today / Week / Month) via querystring.
// The table is server-rendered — we run computeQualityScores() in bulk so
// the rank column is consistent and the page loads as a single round-trip.

import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  computeQualityScores,
  totalBand,
  type QualityWindow,
} from "@/lib/qualityScore";

export const dynamic = "force-dynamic";

const VALID_WINDOWS: QualityWindow[] = ["today", "week", "month"];

interface SearchParams {
  team?: string;
  window?: string;
}

export default async function AdminQualityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const sp = await searchParams;

  const window: QualityWindow = (VALID_WINDOWS as string[]).includes(sp.window ?? "")
    ? (sp.window as QualityWindow)
    : "week";

  // Team filter — default to "all". Managers can switch teams too (helps when
  // they manage cross-team reports).
  const team = sp.team && ["Dubai", "India", "HQ"].includes(sp.team) ? sp.team : "all";

  // Eligible users — active AGENTs + MANAGERs. Managers see only their direct
  // reports plus themselves; admins see everyone.
  const isAdmin = me.role === "ADMIN";
  const baseWhere = {
    active: true,
    hrOnly: false,
    role: { in: [Role.AGENT, Role.MANAGER] },
    ...(team !== "all" ? { team } : {}),
  };
  const users = await prisma.user.findMany({
    where: isAdmin
      ? baseWhere
      : {
          ...baseWhere,
          OR: [{ id: me.id }, { managerId: me.id }],
        },
    select: { id: true, name: true, team: true, role: true },
    orderBy: { name: "asc" },
  });

  // Manager view excludes wellbeing for OTHER users (their direct reports).
  // For themselves, we still want their own wellbeing visible — but to keep
  // the table column-consistent we hide the column entirely in manager view.
  // (Their own personal scoreboard on /dashboard still shows it.)
  const hideWellbeingColumn = me.role === "MANAGER";

  const scoreMap = await computeQualityScores(
    users.map((u) => u.id),
    window,
    { excludeWellbeing: hideWellbeingColumn },
  );

  // Sort users by their total desc — mirrors the rank field but keeps the
  // table coherent if two users tie.
  const sortedUsers = [...users].sort((a, b) => {
    const ta = scoreMap.get(a.id)?.total ?? 0;
    const tb = scoreMap.get(b.id)?.total ?? 0;
    return tb - ta;
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">📊 Quality Score</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Composite performance score per agent. Activity 30% + Funnel 35% + Behavioural 25%
            {hideWellbeingColumn ? " (wellbeing axis hidden — visible only to the agent)" : " + Wellbeing 10%"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center self-start sm:self-auto">
          <div className="seg" title="Time window">
            <Link href={`/admin/quality?window=today&team=${team}`} className={window === "today" ? "on" : ""}>
              Today
            </Link>
            <Link href={`/admin/quality?window=week&team=${team}`} className={window === "week" ? "on" : ""}>
              Week
            </Link>
            <Link href={`/admin/quality?window=month&team=${team}`} className={window === "month" ? "on" : ""}>
              Month
            </Link>
          </div>
          <div className="seg" title="Team filter">
            <Link href={`/admin/quality?team=all&window=${window}`} className={team === "all" ? "on" : ""}>
              All
            </Link>
            <Link href={`/admin/quality?team=Dubai&window=${window}`} className={team === "Dubai" ? "on" : ""}>
              🇦🇪 Dubai
            </Link>
            <Link href={`/admin/quality?team=India&window=${window}`} className={team === "India" ? "on" : ""}>
              🇮🇳 India
            </Link>
          </div>
        </div>
      </div>

      {sortedUsers.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-500">
          No active agents in this scope.
        </div>
      )}

      {sortedUsers.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="tbl w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="text-left">Rank</th>
                <th className="text-left">Agent</th>
                <th className="text-left">Team</th>
                <th className="text-center">Total</th>
                <th className="text-center">Activity</th>
                <th className="text-center">Funnel</th>
                <th className="text-center">Behavioural</th>
                {!hideWellbeingColumn && <th className="text-center">Wellbeing</th>}
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u) => {
                const br = scoreMap.get(u.id);
                if (!br) return null;
                const band = totalBand(br.total);
                return (
                  <tr key={u.id}>
                    <td className="font-bold text-[#0b1a33]">#{br.rank ?? "—"}</td>
                    <td className="font-semibold">
                      {u.name}
                      {u.role === "MANAGER" && (
                        <span className="ml-2 text-[10px] uppercase tracking-widest text-gray-500">Manager</span>
                      )}
                    </td>
                    <td>
                      <span className={`chip ${u.team === "India" ? "src-csv" : "src-wa"}`}>{u.team ?? "—"}</span>
                    </td>
                    <td className="text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-md font-bold ${band.bg} ${band.text}`}>
                        {br.total}
                      </span>
                    </td>
                    <AxisCell value={br.activity} />
                    <AxisCell value={br.funnel} />
                    <AxisCell value={br.behavioural} />
                    {!hideWellbeingColumn && <AxisCell value={br.wellbeing ?? 0} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend — colour band cheat sheet */}
      <div className="text-[11px] text-gray-500 flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> ≥80 strong
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-500" /> 60–79 watching
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> &lt;60 coaching flag
        </span>
      </div>
    </>
  );
}

function AxisCell({ value }: { value: number }) {
  // Match per-axis colour band to the composite total band.
  const colour = value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <td className="text-center">
      <div className="flex items-center gap-2 justify-center">
        <span className="text-xs font-semibold text-gray-700 w-7 text-right">{value}</span>
        <div className="relative h-2 w-16 rounded-full overflow-hidden bg-[#0b1a33]/10">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${colour}`}
            style={{ width: `${Math.max(2, value)}%` }}
          />
        </div>
      </div>
    </td>
  );
}

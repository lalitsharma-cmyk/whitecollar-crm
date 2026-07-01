import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { assignedTodayWhere, freshUntouchedWhere, firstContactPendingWhere } from "@/lib/freshLeads";
import { fmtISTDate } from "@/lib/datetime";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// /reports/fresh-leads — Fresh-Lead Response report (Lalit, 2026-07-01).
//   The one place to see, per agent, whether today's newly-assigned leads are
//   actually being picked up:
//     • Assigned Today       — leads that landed in the agent's queue today (IST)
//     • First Contact Done    — of those, how many have a call/WhatsApp/note logged
//     • Still Untouched       — assigned today, NOTHING logged yet (the risk list)
//     • Backlog Untouched     — assigned ANY day, still never contacted
//   All metrics key off the SINGLE source of truth (freshLeads.ts) — identical to
//   the badges, counts, filters, and escalation cron.
//   ADMIN → all agents (+ optional team filter). MANAGER → own team. AGENT → self.
// ─────────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string;
  name: string;
  team: string | null;
  assignedToday: number;
  untouchedToday: number;
  firstContactDone: number;
  backlogUntouched: number;
}

export default async function FreshLeadsReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;

  // Team scope: ADMIN free choice; MANAGER locked to own team; AGENT → self only.
  const resolvedTeam: "India" | "Dubai" | null =
    me.role === "MANAGER"
      ? ((normalizeTeam(me.team) as "India" | "Dubai" | null) ?? null)
      : me.role === "ADMIN" && (sp.team === "India" || sp.team === "Dubai")
        ? sp.team
        : null;

  // Who appears. AGENT → just themselves; MANAGER → their team; ADMIN → everyone
  // (optionally filtered to one team).
  const agents = me.role === "AGENT"
    ? [{ id: me.id, name: me.name ?? "You", team: me.team }]
    : await prisma.user.findMany({
        where: {
          active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] },
          ...(resolvedTeam ? { team: resolvedTeam } : {}),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, team: true },
      });

  const rows: AgentRow[] = await Promise.all(
    agents.map(async (a) => {
      const [assignedToday, untouchedToday, backlogUntouched] = await Promise.all([
        prisma.lead.count({ where: assignedTodayWhere({ ownerId: a.id }) }),
        prisma.lead.count({ where: freshUntouchedWhere({ ownerId: a.id }) }),
        prisma.lead.count({ where: firstContactPendingWhere({ ownerId: a.id }) }),
      ]);
      return {
        id: a.id,
        name: a.name ?? "—",
        team: a.team,
        assignedToday,
        untouchedToday,
        firstContactDone: Math.max(0, assignedToday - untouchedToday),
        backlogUntouched,
      };
    }),
  );

  // Sort worst-first: most still-untouched today on top so Lalit sees the risk.
  rows.sort((a, b) => b.untouchedToday - a.untouchedToday || b.assignedToday - a.assignedToday);

  const totals = rows.reduce(
    (t, r) => ({
      assignedToday: t.assignedToday + r.assignedToday,
      untouchedToday: t.untouchedToday + r.untouchedToday,
      firstContactDone: t.firstContactDone + r.firstContactDone,
      backlogUntouched: t.backlogUntouched + r.backlogUntouched,
    }),
    { assignedToday: 0, untouchedToday: 0, firstContactDone: 0, backlogUntouched: 0 },
  );
  const pct = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : null);

  const teamHref = (t: string | null) => {
    const p = new URLSearchParams();
    if (t) p.set("team", t);
    const qs = p.toString();
    return `/reports/fresh-leads${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🆕 Fresh-Lead Response</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Today ({fmtISTDate(new Date())} IST) · are today's newly-assigned leads being picked up?
          </p>
        </div>
        {me.role === "ADMIN" && (
          <div className="flex gap-1.5 text-xs">
            <Link href={teamHref(null)} className={`px-3 py-1.5 rounded-lg border font-semibold ${!resolvedTeam ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "bg-white border-gray-200 text-gray-700 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"}`}>All</Link>
            <Link href={teamHref("Dubai")} className={`px-3 py-1.5 rounded-lg border font-semibold ${resolvedTeam === "Dubai" ? "bg-sky-600 text-white border-sky-600" : "bg-white border-gray-200 text-gray-700 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"}`}>🇦🇪 Dubai</Link>
            <Link href={teamHref("India")} className={`px-3 py-1.5 rounded-lg border font-semibold ${resolvedTeam === "India" ? "bg-orange-600 text-white border-orange-600" : "bg-white border-gray-200 text-gray-700 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"}`}>🇮🇳 India</Link>
          </div>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
        <div className="card p-4">
          <div className="text-3xl font-extrabold text-blue-700">{totals.assignedToday}</div>
          <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mt-1">📥 Assigned today</div>
        </div>
        <div className="card p-4">
          <div className="text-3xl font-extrabold text-emerald-700">{totals.firstContactDone}</div>
          <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mt-1">✅ First contact done</div>
          <div className="text-[10px] text-gray-500 mt-0.5">{pct(totals.firstContactDone, totals.assignedToday) ?? "—"}% of assigned</div>
        </div>
        <div className={`card p-4 ${totals.untouchedToday > 0 ? "border-l-4 border-red-500" : ""}`}>
          <div className={`text-3xl font-extrabold ${totals.untouchedToday > 0 ? "text-red-700" : "text-gray-400"}`}>{totals.untouchedToday}</div>
          <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mt-1">⚡ Still untouched</div>
          <div className="text-[10px] text-gray-500 mt-0.5">assigned today · nothing logged</div>
        </div>
        <div className="card p-4">
          <div className="text-3xl font-extrabold text-orange-700">{totals.backlogUntouched}</div>
          <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mt-1">☎ Backlog untouched</div>
          <div className="text-[10px] text-gray-500 mt-0.5">any day · never contacted</div>
        </div>
      </div>

      {/* Per-agent table */}
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 bg-gray-50/80 dark:bg-slate-800/50">
              <th className="px-3 py-2.5">Agent</th>
              <th className="px-3 py-2.5 w-24 text-right">Assigned today</th>
              <th className="px-3 py-2.5 w-28 text-right">First contact done</th>
              <th className="px-3 py-2.5 w-24 text-right">Still untouched</th>
              <th className="px-3 py-2.5 w-24 text-right">Backlog untouched</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">No agents in scope.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={r.untouchedToday > 0 ? "bg-red-50/50 dark:bg-red-950/15" : ""}>
                <td className="px-3 py-2 font-medium text-gray-900 dark:text-slate-100">
                  <Link href={`/leads?fresh=untouched&owner=${r.id}`} className="hover:underline hover:text-[#0b1a33] dark:hover:text-blue-300">{r.name}</Link>
                  {r.team && <span className="ml-1.5 text-[10px] text-gray-400">{r.team}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.assignedToday}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{r.firstContactDone}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.untouchedToday > 0 ? "text-red-600" : "text-gray-400"}`}>{r.untouchedToday}</td>
                <td className="px-3 py-2 text-right tabular-nums text-orange-700 dark:text-orange-400">{r.backlogUntouched}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">
        Click an agent to open their untouched fresh leads. Metrics use the same definition as the Leads badges & filters.
      </p>
    </>
  );
}

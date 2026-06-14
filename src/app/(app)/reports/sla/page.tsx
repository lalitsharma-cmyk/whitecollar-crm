import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { ActivityType, ActivityStatus, Prisma } from "@prisma/client";
import { format, startOfMonth, endOfMonth, subMonths, differenceInCalendarDays, subDays } from "date-fns";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface VisitRow {
  agent: string;
  agentId: string;
  team: string | null;
  // Per-type counts
  scheduled: number;
  completed: number;
  noShow: number;
  rescheduled: number;
  attendedByOwner: number;
  attendedBySomeoneElse: number;
  jointVisits: number;
}

interface MonthBlock {
  label: string;
  start: Date;
  end: Date;
  byType: Record<string, { scheduled: number; completed: number; noShow: number; rescheduled: number }>;
  perAgent: VisitRow[];
}

const VISIT_TYPES: ActivityType[] = ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING"] as ActivityType[];

// Strict YYYY-MM-DD → UTC midnight. Reject junk so we don't slip an
// Invalid Date into a Prisma gte filter.
function parseYmd(s: string | undefined): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function endOfDayUtc(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function computeMonth(start: Date, end: Date, label: string, agentScope: string | null, teamFilter: string | null): Promise<MonthBlock> {
  const where: Prisma.ActivityWhereInput = {
    type: { in: VISIT_TYPES },
    OR: [
      { scheduledAt: { gte: start, lte: end } },
      { completedAt: { gte: start, lte: end } },
    ],
    lead: { deletedAt: null, ...(teamFilter ? { forwardedTeam: teamFilter } : {}) },
  };
  if (agentScope) where.userId = agentScope;
  const activities = await prisma.activity.findMany({
    where,
    include: { user: true },
  });

  const byType: MonthBlock["byType"] = {};
  for (const t of VISIT_TYPES) byType[t] = { scheduled: 0, completed: 0, noShow: 0, rescheduled: 0 };
  const perAgentMap = new Map<string, VisitRow>();

  for (const a of activities) {
    const slot = byType[a.type] ?? { scheduled: 0, completed: 0, noShow: 0, rescheduled: 0 };
    slot.scheduled++;
    if (a.status === ActivityStatus.DONE) slot.completed++;
    if (a.isNoShow) slot.noShow++;
    if (a.rescheduledCount && a.rescheduledCount > 0) slot.rescheduled += a.rescheduledCount;
    byType[a.type] = slot;

    // Per-agent breakdown — use the activity's owner as "the agent"; attendance details enrich
    const aid = a.userId ?? a.attendedByUserId ?? "unassigned";
    const row = perAgentMap.get(aid) ?? {
      agent: a.user?.name ?? "Unassigned",
      agentId: aid,
      team: a.user?.team ?? null,
      scheduled: 0, completed: 0, noShow: 0, rescheduled: 0,
      attendedByOwner: 0, attendedBySomeoneElse: 0, jointVisits: 0,
    };
    row.scheduled++;
    if (a.status === ActivityStatus.DONE) row.completed++;
    if (a.isNoShow) row.noShow++;
    if (a.rescheduledCount && a.rescheduledCount > 0) row.rescheduled += a.rescheduledCount;
    // Attendance attribution
    if (a.attendedByUserId && a.attendedByUserId !== a.userId) row.attendedBySomeoneElse++;
    else if (a.attendedByUserId === a.userId) row.attendedByOwner++;
    if (a.additionalAttendees && a.additionalAttendees.trim()) row.jointVisits++;
    perAgentMap.set(aid, row);
  }

  return { label, start, end, byType, perAgent: [...perAgentMap.values()].sort((a, b) => b.scheduled - a.scheduled) };
}

export default async function SlaReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/reports");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;
  // Admin/manager see everything (with optional ?agent=…)
  const agentScope = sp.agent ?? null;

  // ── Date range resolution ────────────────────────────────────────────
  // Per Lalit feedback 2026-06: the page used to be fixed at
  // "this month / last month" — now it accepts ?from=&to= via the shared
  // ReportDateRangePicker. Default window = this month, which preserves
  // the previous look for anyone visiting without params.
  //
  // We also keep the dual-block compare-to-prior-period view because the
  // month-over-month delta is the actual SLA story; we just relabel the
  // headers so block A = the picked window and block B = the same length
  // immediately preceding it.
  const now = new Date();
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  const primaryStart = fromParam ?? startOfMonth(now);
  const primaryEnd = toParam ? endOfDayUtc(toParam) : endOfMonth(now);

  // Compute the "previous N days" block — same span as primary, ending
  // the day before primary starts. For the default (this month) case we
  // intentionally fall back to startOfMonth(lastMonth)/endOfMonth(lastMonth)
  // so the label still reads as a clean calendar-month comparison — the
  // most familiar SLA framing.
  const usingDefaultMonth = !fromParam && !toParam;
  let prevStart: Date;
  let prevEnd: Date;
  let primaryLabel: string;
  let prevLabel: string;
  if (usingDefaultMonth) {
    prevStart = startOfMonth(subMonths(now, 1));
    prevEnd = endOfMonth(subMonths(now, 1));
    primaryLabel = format(now, "MMMM yyyy");
    prevLabel = format(subMonths(now, 1), "MMMM yyyy");
  } else {
    // Length in days (inclusive). +1 because differenceInCalendarDays
    // treats same-day as 0.
    const span = Math.max(1, differenceInCalendarDays(primaryEnd, primaryStart) + 1);
    prevEnd = endOfDayUtc(subDays(primaryStart, 1));
    prevStart = subDays(prevEnd, span - 1);
    prevStart.setUTCHours(0, 0, 0, 0);
    primaryLabel = `${toYmd(primaryStart)} → ${toYmd(primaryEnd)}`;
    prevLabel = `Previous ${span} day${span === 1 ? "" : "s"} · ${toYmd(prevStart)} → ${toYmd(prevEnd)}`;
  }

  const [thisM, lastM, agents] = await Promise.all([
    computeMonth(primaryStart, primaryEnd, primaryLabel, agentScope, managerTeam),
    computeMonth(prevStart, prevEnd, prevLabel, agentScope, managerTeam),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] }, ...(managerTeam ? { team: managerTeam } : {}) }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          {/* Back link added per Lalit feedback 2026-06. */}
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">📊 SLA & Meeting Report</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Site visits, office meetings, and virtual meetings — rescheduled, no-shows, and who actually attended.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Filter by agent:</span>
          <Link href="/reports/sla" className={`chip text-[10px] ${!agentScope ? "chip-warm" : "chip-lost"}`}>All agents</Link>
          {agents.map((u) => (
            <Link key={u.id} href={`/reports/sla?agent=${u.id}`}
              className={`chip text-[10px] ${agentScope === u.id ? "chip-warm" : "chip-lost"}`}>{u.name}</Link>
          ))}
        </div>
      </div>

      {/* Shared date-range picker — writes ?from=&to=. Default window is
          this month so visitors who don't pick see the same layout as before. */}
      <ReportDateRangePicker defaultFrom={toYmd(primaryStart)} defaultTo={toYmd(primaryEnd)} />

      {[thisM, lastM].map((m) => (
        <section key={m.label} className="space-y-3">
          <h2 className="text-base font-bold text-[#0b1a33]">{m.label}</h2>

          {/* By type */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {VISIT_TYPES.map((t) => {
              const row = m.byType[t] ?? { scheduled: 0, completed: 0, noShow: 0, rescheduled: 0 };
              const completedRate = row.scheduled ? Math.round((row.completed / row.scheduled) * 100) : 0;
              const noShowRate = row.scheduled ? Math.round((row.noShow / row.scheduled) * 100) : 0;
              const label = t === "SITE_VISIT" ? "🚗 Site visits" : t === "OFFICE_MEETING" ? "🏢 Office meetings" : "💻 Virtual meetings";
              return (
                <div key={t} className="card p-4">
                  <div className="text-xs font-bold tracking-widest text-gray-500">{label}</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <Stat label="Scheduled" value={row.scheduled} />
                    <Stat label="Completed" value={row.completed} sub={`${completedRate}%`} highlight="emerald" />
                    <Stat label="Rescheduled" value={row.rescheduled} highlight={row.rescheduled > 0 ? "amber" : undefined} />
                    <Stat label="No-show" value={row.noShow} sub={`${noShowRate}%`} highlight={row.noShow > 0 ? "red" : undefined} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-agent table */}
          <div className="card overflow-x-auto">
            <table className="tbl min-w-[760px]">
                <thead><tr>
                  <th>Agent</th><th>Team</th>
                  <th className="text-center">Scheduled</th>
                  <th className="text-center">Completed</th>
                  <th className="text-center">No-show</th>
                  <th className="text-center">Reschedules</th>
                  <th className="text-center">Attended self</th>
                  <th className="text-center">Sent someone else</th>
                  <th className="text-center">Joint (with team)</th>
                </tr></thead>
                <tbody>
                  {m.perAgent.length === 0 && (
                    <tr><td colSpan={9} className="text-center text-gray-500 py-6 text-sm">No visits or meetings logged.</td></tr>
                  )}
                  {m.perAgent.map((r) => (
                    <tr key={r.agentId}>
                      <td className="font-semibold">{r.agent}</td>
                      <td><span className={`chip ${r.team === "India" ? "src-csv" : "src-wa"}`}>{r.team ?? "—"}</span></td>
                      <td className="text-center">{r.scheduled}</td>
                      <td className="text-center text-emerald-700 font-semibold">{r.completed}</td>
                      <td className={`text-center ${r.noShow > 0 ? "text-red-600 font-semibold" : ""}`}>{r.noShow}</td>
                      <td className={`text-center ${r.rescheduled > 0 ? "text-amber-600 font-semibold" : ""}`}>{r.rescheduled}</td>
                      <td className="text-center">{r.attendedByOwner}</td>
                      <td className={`text-center ${r.attendedBySomeoneElse > 0 ? "text-amber-700 font-semibold" : ""}`}>{r.attendedBySomeoneElse}</td>
                      <td className="text-center">{r.jointVisits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
        </section>
      ))}
    </>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: number; sub?: string; highlight?: "emerald" | "amber" | "red" }) {
  const cls =
    highlight === "emerald" ? "text-emerald-700" :
    highlight === "amber" ? "text-amber-700" :
    highlight === "red" ? "text-red-700" :
    "text-[#0b1a33]";
  return (
    <div>
      <div className={`text-xl font-bold ${cls}`}>{value}{sub && <span className="text-xs text-gray-500 ml-1">{sub}</span>}</div>
      <div className="text-[10px] tracking-widest text-gray-500 uppercase">{label}</div>
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { startOfMonth, endOfMonth, subMonths, format, differenceInCalendarDays, subDays } from "date-fns";
import { getTravelRatePerKmInr } from "@/lib/settings";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface Row {
  userId: string;
  name: string;
  team: string | null;
  trips: number;
  km: number;
  amount: number;
}

// Strict YYYY-MM-DD → UTC midnight.
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

async function compute(start: Date, end: Date, agentScope: string | null, teamFilter: string | null): Promise<Row[]> {
  const acts = await prisma.activity.findMany({
    where: {
      completedAt: { gte: start, lte: end },
      distanceKm: { not: null },
      ...(agentScope ? { userId: agentScope } : {}),
      ...(teamFilter ? { lead: { forwardedTeam: teamFilter } } : {}),
    },
    include: { user: true },
  });
  const map = new Map<string, Row>();
  for (const a of acts) {
    const uid = a.userId ?? "unknown";
    const row = map.get(uid) ?? { userId: uid, name: a.user?.name ?? "Unknown", team: a.user?.team ?? null, trips: 0, km: 0, amount: 0 };
    row.trips++;
    row.km += a.distanceKm ?? 0;
    row.amount += a.reimbursementAmount ?? 0;
    map.set(uid, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export default async function TravelReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/reports");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;
  const agentScope = sp.agent ?? null;

  // ── Date range resolution ────────────────────────────────────────────
  // Per Lalit feedback 2026-06: page now accepts ?from=&to= via the shared
  // ReportDateRangePicker. Default window = this month, preserving the
  // previous look. We keep the dual-block prior-period comparison so the
  // month-over-month travel-cost story is still visible.
  const now = new Date();
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  const primaryStart = fromParam ?? startOfMonth(now);
  const primaryEnd = toParam ? endOfDayUtc(toParam) : endOfMonth(now);

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
    const span = Math.max(1, differenceInCalendarDays(primaryEnd, primaryStart) + 1);
    prevEnd = endOfDayUtc(subDays(primaryStart, 1));
    prevStart = subDays(prevEnd, span - 1);
    prevStart.setUTCHours(0, 0, 0, 0);
    primaryLabel = `${toYmd(primaryStart)} → ${toYmd(primaryEnd)}`;
    prevLabel = `Previous ${span} day${span === 1 ? "" : "s"} · ${toYmd(prevStart)} → ${toYmd(prevEnd)}`;
  }

  const [thisM, lastM, rate, agents] = await Promise.all([
    compute(primaryStart, primaryEnd, agentScope, managerTeam),
    compute(prevStart, prevEnd, agentScope, managerTeam),
    getTravelRatePerKmInr(),
    prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] }, ...(managerTeam ? { team: managerTeam } : {}) }, orderBy: { name: "asc" } }),
  ]);

  const thisTotal = thisM.reduce((s, r) => s + r.amount, 0);
  const lastTotal = lastM.reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <div>
        {/* Back link added per Lalit feedback 2026-06. */}
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold">🚗 Travel Reimbursement</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Distance + reimbursement totals per agent. Rate currently: <b>₹{rate}/km</b>
          {me.role === "ADMIN" && <span> · <Link href="/settings" className="underline">change in Settings</Link></span>}
        </p>
      </div>

      {/* Shared date-range picker — writes ?from=&to=. Default window is
          this month so visitors without params see the same layout as before. */}
      <ReportDateRangePicker defaultFrom={toYmd(primaryStart)} defaultTo={toYmd(primaryEnd)} />

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500">Filter by agent:</span>
        <Link href="/reports/travel" className={`chip text-[10px] ${!agentScope ? "chip-warm" : "chip-lost"}`}>All</Link>
        {agents.map((u) => (
          <Link key={u.id} href={`/reports/travel?agent=${u.id}`}
            className={`chip text-[10px] ${agentScope === u.id ? "chip-warm" : "chip-lost"}`}>{u.name}</Link>
        ))}
      </div>

      {[
        { m: thisM, label: primaryLabel, total: thisTotal },
        { m: lastM, label: prevLabel, total: lastTotal },
      ].map((blk) => (
        <section key={blk.label}>
          <h2 className="text-base font-bold text-[#0b1a33] mb-2">{blk.label} <span className="text-sm text-gray-500 font-normal">· total ₹{blk.total.toLocaleString("en-IN")}</span></h2>
          <div className="card overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead><tr>
                <th>Agent</th><th>Team</th>
                <th className="text-center">Trips</th>
                <th className="text-center">Total km</th>
                <th className="text-center">Reimbursement</th>
              </tr></thead>
              <tbody>
                {blk.m.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray-500 py-6 text-sm">No travel logged in this window.</td></tr>
                )}
                {blk.m.map((r) => (
                  <tr key={r.userId}>
                    <td className="font-semibold">{r.name}</td>
                    <td><span className={`chip ${r.team === "India" ? "src-csv" : "src-wa"}`}>{r.team ?? "—"}</span></td>
                    <td className="text-center">{r.trips}</td>
                    <td className="text-center">{r.km.toFixed(1)}</td>
                    <td className="text-center font-semibold">₹{r.amount.toLocaleString("en-IN")}</td>
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

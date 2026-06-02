import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { startOfDay, endOfDay, format, parseISO, isValid } from "date-fns";
import Link from "next/link";
import { ActivityType, LeadStatus, CallOutcome, TargetMetric } from "@prisma/client";

export const dynamic = "force-dynamic";

// Mirrors Lalit's manual daily sheet:
//   Total number of calls          (CallLog count)
//   Number of Connecting Calls     (CallLog.outcome=CONNECTED)
//   Virtual Meetings               (Activity.type=VIRTUAL_MEETING, DONE)
//   F2F Meetings                   (Activity.type IN (OFFICE_MEETING, SITE_VISIT, HOME_VISIT), DONE)
//   Fresh Clients (Cold Calls)     (Activity.type=COLD_TO_LEAD, DONE)
//   Deals Closed (Number)          (Lead status -> WON today)
//   Sales Closing Value            (sum budgetMin of leads marked WON today)

interface Row {
  metric: string;
  target: number;
  achieved: number;
  showPct?: boolean;
  currency?: "AED" | "INR" | null;
}

async function readTarget(userId: string, metric: TargetMetric): Promise<number> {
  // Active DAILY target for this user — most recent row wins
  const t = await prisma.target.findFirst({
    where: { userId, metric, period: "DAILY" },
    orderBy: { startDate: "desc" },
  });
  return t?.value ?? 0;
}

export default async function DailyReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";

  // Date — defaults to today, can be overridden via ?date=YYYY-MM-DD
  let day = new Date();
  if (sp.date) {
    const parsed = parseISO(sp.date);
    if (isValid(parsed)) day = parsed;
  }
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);

  // Agent scope: agents always see themselves; admin/manager can pick via ?agent=
  const targetUserId = me.role === "AGENT" ? me.id : (sp.agent ?? me.id);
  const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!targetUser) return <div className="card p-6">Agent not found</div>;

  // ── Pull actuals for the chosen day, scoped to the chosen agent ─────
  const [calls, connected, virtualDone, f2fDone, freshClients, dealsWonToday] = await Promise.all([
    prisma.callLog.count({ where: { userId: targetUserId, startedAt: { gte: dayStart, lte: dayEnd } } }),
    prisma.callLog.count({ where: { userId: targetUserId, startedAt: { gte: dayStart, lte: dayEnd }, outcome: CallOutcome.CONNECTED } }),
    prisma.activity.count({ where: { userId: targetUserId, type: ActivityType.VIRTUAL_MEETING, completedAt: { gte: dayStart, lte: dayEnd } } }),
    prisma.activity.count({ where: {
      userId: targetUserId,
      type: { in: [ActivityType.OFFICE_MEETING, ActivityType.SITE_VISIT, ActivityType.HOME_VISIT, ActivityType.EXPO_MEETING] },
      completedAt: { gte: dayStart, lte: dayEnd },
    } }),
    prisma.activity.count({ where: { userId: targetUserId, type: ActivityType.COLD_TO_LEAD, completedAt: { gte: dayStart, lte: dayEnd } } }),
    // Leads marked WON today by this owner — count + revenue
    prisma.lead.findMany({
      where: { ownerId: targetUserId, status: LeadStatus.WON, updatedAt: { gte: dayStart, lte: dayEnd } },
      select: { budgetMin: true, budgetCurrency: true },
    }),
  ]);

  const dealsClosedCount = dealsWonToday.length;
  // Split revenue by currency (Dubai → AED, India → INR)
  const revenueAed = dealsWonToday.filter((d) => (d.budgetCurrency ?? "AED") === "AED").reduce((s, d) => s + (d.budgetMin ?? 0), 0);
  const revenueInr = dealsWonToday.filter((d) => d.budgetCurrency === "INR").reduce((s, d) => s + (d.budgetMin ?? 0), 0);
  const teamCurrency = targetUser.team === "India" ? "INR" : "AED";
  const revenueForTeam = teamCurrency === "INR" ? revenueInr : revenueAed;

  // ── Pull targets ────────────────────────────────────────────────────
  const [tCalls, tConnected, tVirtual, tF2F, tFresh, tDeals, tRevenue] = await Promise.all([
    readTarget(targetUserId, TargetMetric.CALLS),
    readTarget(targetUserId, TargetMetric.CONNECTED_CALLS),
    readTarget(targetUserId, TargetMetric.VIRTUAL_MEETINGS),
    readTarget(targetUserId, TargetMetric.F2F_MEETINGS),
    readTarget(targetUserId, TargetMetric.FRESH_CLIENTS),
    readTarget(targetUserId, TargetMetric.DEALS_CLOSED),
    readTarget(targetUserId, teamCurrency === "AED" ? TargetMetric.REVENUE_AED : TargetMetric.REVENUE_INR),
  ]);

  const rows: Row[] = [
    { metric: "Total number of calls", target: tCalls, achieved: calls },
    { metric: "Number of Connecting Calls", target: tConnected, achieved: connected, showPct: true },
    { metric: "Virtual Meetings", target: tVirtual, achieved: virtualDone, showPct: true },
    { metric: "F2F Meetings (office + site + home)", target: tF2F, achieved: f2fDone, showPct: true },
    { metric: "Fresh Clients (Cold→Lead)", target: tFresh, achieved: freshClients, showPct: true },
    { metric: "Deals Closed (Number)", target: tDeals, achieved: dealsClosedCount, showPct: true },
    { metric: `Sales Closing Value (${teamCurrency})`, target: tRevenue, achieved: revenueForTeam, showPct: true, currency: teamCurrency },
  ];

  // Day navigation
  const prevDay = format(new Date(dayStart.getTime() - 86400000), "yyyy-MM-dd");
  const nextDay = format(new Date(dayStart.getTime() + 86400000), "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const dayStr = format(day, "yyyy-MM-dd");

  // Agents list for admin/manager dropdown
  const agents = isAdminOrMgr
    ? await prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } })
    : [];

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          {/* Back link added per Lalit feedback 2026-06 — managers were
              getting "lost" inside individual report pages with no obvious
              way back to the reports hub. Same affordance as the
              team-comparison / commission pages. */}
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">📅 Daily Report — {targetUser.name}</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Auto-generated. {format(day, "dd-MMM-yy")} · Team: {targetUser.team ?? "—"}
            {isAdminOrMgr && me.role === "ADMIN" && (
              <span> · <Link href="/admin/targets" className="underline">Set daily targets</Link></span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center self-start sm:self-auto">
          {/* Calendar input added per Lalit feedback 2026-06 — picking a
              specific historic date via prev/next chips was tedious.
              The form GETs back to this same page with ?date=YYYY-MM-DD,
              preserving the agent param if set. No JS required — the
              native date picker on Chrome/Edge/Safari opens a calendar. */}
          <form method="get" action="/reports/daily" className="flex gap-1 items-center">
            <label htmlFor="daily-date-picker" className="sr-only">Pick a date</label>
            <input
              id="daily-date-picker"
              type="date"
              name="date"
              defaultValue={dayStr}
              max={todayStr}
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
            />
            {sp.agent && <input type="hidden" name="agent" value={sp.agent} />}
            <button type="submit" className="btn btn-ghost text-xs">Go</button>
          </form>
          <Link href={`/reports/daily?date=${prevDay}${sp.agent ? `&agent=${sp.agent}` : ""}`} className="btn btn-ghost text-xs">‹ Prev day</Link>
          <Link href={`/reports/daily?date=${todayStr}${sp.agent ? `&agent=${sp.agent}` : ""}`} className="btn btn-ghost text-xs">Today</Link>
          {dayStr < todayStr && (
            <Link href={`/reports/daily?date=${nextDay}${sp.agent ? `&agent=${sp.agent}` : ""}`} className="btn btn-ghost text-xs">Next day ›</Link>
          )}
          {isAdminOrMgr && (
            <a
              href={`/api/reports/daily/pdf?date=${dayStr}${sp.agent ? `&agent=${sp.agent}` : ""}${sp.team ? `&team=${sp.team}` : ""}`}
              className="btn btn-primary text-xs"
              download
            >⬇ Download PDF</a>
          )}
        </div>
      </div>

      {/* Agent picker (admin/manager only) */}
      {isAdminOrMgr && (
        <div className="card p-3 flex flex-wrap gap-2 items-center text-xs">
          <span className="text-gray-500 font-semibold">Agent:</span>
          {agents.map((a) => (
            <Link
              key={a.id}
              href={`/reports/daily?date=${dayStr}&agent=${a.id}`}
              className={`chip text-xs min-h-9 px-2.5 ${a.id === targetUserId ? "chip-warm" : "chip-lost"}`}
            >{a.name}</Link>
          ))}
        </div>
      )}

      {/* The main report table — matches your manual sheet.
          min-w bumped down from 600px to 460px so it fits a 360px phone
          with a small horizontal scroll instead of being far off-screen. */}
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[460px]">
          <thead>
            <tr className="bg-amber-100">
              <th colSpan={5} className="text-center text-sm font-bold py-2">{format(day, "dd-MMM-yy")}</th>
            </tr>
            <tr>
              <th>Metrics</th>
              <th className="text-center">Target</th>
              <th className="text-center">Achieved</th>
              <th className="text-center">Pending</th>
              <th className="text-center">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pending = Math.max(0, r.target - r.achieved);
              const pct = r.target > 0 ? Math.round((r.achieved / r.target) * 100) : (r.achieved > 0 ? 100 : 0);
              const pctClass = pct >= 100 ? "text-emerald-700 font-bold" : pct >= 50 ? "text-amber-700" : "text-red-700";
              const isMoney = r.currency != null;
              const fmt = (n: number) => isMoney ? (r.currency === "INR" ? `₹${(n/1e7).toFixed(2)}Cr` : `AED ${(n/1e6).toFixed(2)}M`) : String(n);
              return (
                <tr key={r.metric}>
                  <td className="font-semibold text-sm">{r.metric}</td>
                  <td className="text-center text-sm">{fmt(r.target)}</td>
                  <td className="text-center text-sm font-bold">{fmt(r.achieved)}</td>
                  <td className={`text-center text-sm ${pending > 0 ? "text-red-600 font-semibold" : "text-gray-500"}`}>{fmt(pending)}</td>
                  <td className={`text-center text-sm ${pctClass}`}>{r.showPct ? `${pct}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[10px] text-gray-500 p-3">
          Achieved & Pending are computed live from CallLogs + Activities + Lead status changes. Targets are set per-agent in <code>/admin/targets</code>.
        </div>
      </div>

      {!tCalls && !tConnected && !tDeals && (
        <div className="card p-4 border-l-4 border-amber-500 bg-amber-50 text-sm">
          ⚠ No daily targets set for {targetUser.name} yet — all "%" columns will show based on achieved-only counts.
          {me.role === "ADMIN" && <span> Set targets at <Link href="/admin/targets" className="underline font-semibold">/admin/targets</Link>.</span>}
        </div>
      )}
    </>
  );
}

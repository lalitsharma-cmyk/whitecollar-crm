// ════════════════════════════════════════════════════════════════════════════
// CALL LOGS — KPI computation (Lalit P0, 2026-07-18)
//
// Turns the Call Logs page from a table into an operations dashboard: a row of
// live KPI cards above the table, every card clickable to drill into exactly the
// rows it counted.
//
// ── THE SYNCHRONISATION GUARANTEE ───────────────────────────────────────────
// The cards are computed from the SAME `where` the table is built from, minus
// only the outcome/state predicate (see below). They cannot drift, because there
// is no second definition of "which calls are we looking at" — the page assembles
// one where-clause and hands it here. If you add a filter to the page, it flows
// into the cards automatically.
//
// ── WHY THE OUTCOME PREDICATE IS STRIPPED ───────────────────────────────────
// If the cards honoured a pinned ?outcome=, then clicking "Connected" would show
// Connected = N and every other card = 0 — the cards would stop being a usable
// breakdown the moment you used them. Instead the cards always show the full
// breakdown for the CURRENT user/team/module/date/search filters, and the pinned
// status is HIGHLIGHTED. The table still honours the pin.
//
// count==records is preserved exactly: the number on the Connected card is
// produced by the same predicate that the card's link applies to the table, so
// clicking a card that reads 47 lands on a table of 47.
// ════════════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { CallOutcome, type Prisma } from "@prisma/client";
import { PENDING_CALL_OUTCOMES } from "@/lib/ghosting";

export interface CallKpis {
  /** Resolved calls only — a dial with no result is not a call. */
  total: number;
  /** Per-outcome counts, every CallOutcome present (0 when unused). */
  byOutcome: Record<CallOutcome, number>;
  /** Unresolved dials (INITIATED / RINGING) — counted, never mixed into `total`. */
  pending: number;
  /** Seconds of logged talk time. */
  talkTimeSec: number;
  /** Mean duration over calls that HAVE a duration (see coverage below). */
  avgDurationSec: number;
  /** How many resolved calls carry a duration, and how many of those connected.
   *  Surfaced so the UI can be honest: duration is entered by hand today, so
   *  talk time is a floor, not a true total. */
  durationCoverage: { withDuration: number; connected: number; connectedWithDuration: number };
  /** connected / resolved, as a percentage (0 when there are no resolved calls). */
  connectionRate: number;
}

/** Outcomes that mean a human conversation happened. CONNECTED doubles as
 *  "Completed" — the enum has one value for both, so the UI shows ONE card. */
const CONNECTED_SET: CallOutcome[] = [CallOutcome.CONNECTED];

/**
 * Compute every KPI in two queries, regardless of how many cards are displayed.
 *
 * `baseWhere` MUST already carry the role scope + the link/date/user/team/module/
 * search filters, and MUST NOT carry the outcome or state predicate — the page
 * assembles it that way (see `kpiWhere` there).
 */
export async function computeCallKpis(baseWhere: Prisma.CallLogWhereInput): Promise<CallKpis> {
  const [grouped, durAgg, connDurCount] = await Promise.all([
    prisma.callLog.groupBy({
      by: ["outcome"],
      where: baseWhere,
      _count: { _all: true },
      _sum: { durationSec: true },
    }),
    // Talk time / average over rows that actually carry a duration. Averaging
    // over ALL rows would divide real talk time by a mostly-null column and
    // report an average several times too low.
    prisma.callLog.aggregate({
      where: { ...baseWhere, durationSec: { gt: 0 }, outcome: { notIn: [...PENDING_CALL_OUTCOMES] } },
      _sum: { durationSec: true },
      _avg: { durationSec: true },
      _count: { _all: true },
    }),
    prisma.callLog.count({
      where: { ...baseWhere, outcome: { in: CONNECTED_SET }, durationSec: { gt: 0 } },
    }),
  ]);

  return assembleKpis(
    grouped.map((g) => ({ outcome: g.outcome, count: g._count._all })),
    { sum: durAgg._sum.durationSec ?? 0, avg: durAgg._avg.durationSec ?? 0, withDuration: durAgg._count._all },
    connDurCount,
  );
}

/** Pure assembly of a CallKpis from per-outcome counts + duration aggregates.
 *  SHARED by the overall KPIs and the per-agent breakdown so the two can NEVER
 *  use different math — an agent card's numbers are the same computation as the
 *  overall strip, just scoped to one userId. */
function assembleKpis(
  perOutcome: { outcome: string; count: number }[],
  dur: { sum: number; avg: number; withDuration: number },
  connectedWithDuration: number,
): CallKpis {
  const byOutcome = Object.fromEntries(
    (Object.keys(CallOutcome) as CallOutcome[]).map((o) => [o, 0]),
  ) as Record<CallOutcome, number>;
  for (const g of perOutcome) byOutcome[g.outcome as CallOutcome] = g.count;

  const pendingSet = new Set<string>(PENDING_CALL_OUTCOMES);
  const pending = perOutcome.filter((g) => pendingSet.has(g.outcome)).reduce((s, g) => s + g.count, 0);
  const total = perOutcome.filter((g) => !pendingSet.has(g.outcome)).reduce((s, g) => s + g.count, 0);
  const connected = byOutcome[CallOutcome.CONNECTED];

  return {
    total,
    byOutcome,
    pending,
    talkTimeSec: dur.sum,
    avgDurationSec: Math.round(dur.avg),
    durationCoverage: { withDuration: dur.withDuration, connected, connectedWithDuration },
    connectionRate: total > 0 ? Math.round((connected / total) * 1000) / 10 : 0,
  };
}

// ── PER-AGENT BREAKDOWN (Lalit, 2026-07-22) ─────────────────────────────────
// The compact agent-performance strip. Each agent's numbers come from the SAME
// baseWhere (kpiWhere) as the overall strip + table — role scope, date, module,
// search, everything — so cards, KPIs and table can never disagree. Never from a
// per-module counter: it's the one centralized CallLog, grouped by userId.
export interface AgentKpi {
  userId: string;
  name: string;
  team: string | null;
  kpis: CallKpis;
}

/**
 * Per-agent CallKpis for the given roster, scoped by baseWhere. Three grouped
 * queries total (not N×per-agent), so it stays fast with the whole team.
 * `roster` fixes WHICH agents get a card (order preserved) — resolved to live
 * user records by the caller, so a renamed/removed user is handled by simply not
 * being in the roster.
 */
export async function computeAgentBreakdown(
  baseWhere: Prisma.CallLogWhereInput,
  roster: { id: string; name: string; team: string | null }[],
): Promise<AgentKpi[]> {
  const ids = roster.map((r) => r.id);
  if (ids.length === 0) return [];
  const scoped = { AND: [baseWhere, { userId: { in: ids } }] } as Prisma.CallLogWhereInput;

  const [grouped, durRows, connDurRows] = await Promise.all([
    prisma.callLog.groupBy({ by: ["userId", "outcome"], where: scoped, _count: { _all: true } }),
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { AND: [baseWhere, { userId: { in: ids }, durationSec: { gt: 0 }, outcome: { notIn: [...PENDING_CALL_OUTCOMES] } }] },
      _sum: { durationSec: true }, _avg: { durationSec: true }, _count: { _all: true },
    }),
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { AND: [baseWhere, { userId: { in: ids }, outcome: { in: CONNECTED_SET }, durationSec: { gt: 0 } }] },
      _count: { _all: true },
    }),
  ]);

  const perOutcomeByUser = new Map<string, { outcome: string; count: number }[]>();
  for (const g of grouped) {
    if (!g.userId) continue;
    const list = perOutcomeByUser.get(g.userId) ?? [];
    list.push({ outcome: g.outcome, count: g._count._all });
    perOutcomeByUser.set(g.userId, list);
  }
  const durByUser = new Map(durRows.filter((d) => d.userId).map((d) => [d.userId as string, d]));
  const connDurByUser = new Map(connDurRows.filter((d) => d.userId).map((d) => [d.userId as string, d._count._all]));

  // Preserve roster order — the caller decides ordering (e.g. by call volume).
  return roster.map((r) => {
    const d = durByUser.get(r.id);
    return {
      userId: r.id,
      name: r.name,
      team: r.team,
      kpis: assembleKpis(
        perOutcomeByUser.get(r.id) ?? [],
        { sum: d?._sum.durationSec ?? 0, avg: d?._avg.durationSec ?? 0, withDuration: d?._count._all ?? 0 },
        connDurByUser.get(r.id) ?? 0,
      ),
    };
  });
}

// ── Per-user colour identity ────────────────────────────────────────────────
// Deterministic: the SAME agent keeps the SAME colour across sessions/devices
// (hash of the stable userId, never a random or index-by-render assignment).
// Each entry carries light + dark classes so cards read well in both themes.
const AGENT_PALETTE = [
  { bar: "bg-blue-500", tint: "bg-blue-50 dark:bg-blue-950/40", text: "text-blue-700 dark:text-blue-300", ring: "ring-blue-500" },
  { bar: "bg-emerald-500", tint: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", ring: "ring-emerald-500" },
  { bar: "bg-violet-500", tint: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-700 dark:text-violet-300", ring: "ring-violet-500" },
  { bar: "bg-amber-500", tint: "bg-amber-50 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300", ring: "ring-amber-500" },
  { bar: "bg-rose-500", tint: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-700 dark:text-rose-300", ring: "ring-rose-500" },
  { bar: "bg-cyan-500", tint: "bg-cyan-50 dark:bg-cyan-950/40", text: "text-cyan-700 dark:text-cyan-300", ring: "ring-cyan-500" },
  { bar: "bg-indigo-500", tint: "bg-indigo-50 dark:bg-indigo-950/40", text: "text-indigo-700 dark:text-indigo-300", ring: "ring-indigo-500" },
  { bar: "bg-teal-500", tint: "bg-teal-50 dark:bg-teal-950/40", text: "text-teal-700 dark:text-teal-300", ring: "ring-teal-500" },
];
export type AgentColor = (typeof AGENT_PALETTE)[number];
export function agentColor(userId: string): AgentColor {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AGENT_PALETTE[h % AGENT_PALETTE.length];
}

/** mm:ss / h m — compact, for a KPI tile. */
export function formatDuration(sec: number): string {
  if (!sec || sec < 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

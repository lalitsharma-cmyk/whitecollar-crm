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

  const byOutcome = Object.fromEntries(
    (Object.keys(CallOutcome) as CallOutcome[]).map((o) => [o, 0]),
  ) as Record<CallOutcome, number>;
  for (const g of grouped) byOutcome[g.outcome] = g._count._all;

  const pendingSet = new Set<string>(PENDING_CALL_OUTCOMES);
  const pending = grouped.filter((g) => pendingSet.has(g.outcome)).reduce((s, g) => s + g._count._all, 0);
  const total = grouped.filter((g) => !pendingSet.has(g.outcome)).reduce((s, g) => s + g._count._all, 0);
  const connected = byOutcome[CallOutcome.CONNECTED];

  return {
    total,
    byOutcome,
    pending,
    talkTimeSec: durAgg._sum.durationSec ?? 0,
    avgDurationSec: Math.round(durAgg._avg.durationSec ?? 0),
    durationCoverage: {
      withDuration: durAgg._count._all,
      connected,
      connectedWithDuration: connDurCount,
    },
    // Denominator is RESOLVED calls. Including unresolved dials would silently
    // depress the rate as dials accumulate — the same trap that had to be closed
    // across every other connect-rate surface in the CRM.
    connectionRate: total > 0 ? Math.round((connected / total) * 1000) / 10 : 0,
  };
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

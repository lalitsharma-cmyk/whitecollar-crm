import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { ActivityType, CallOutcome, Prisma } from "@prisma/client";
import { ACTIVE_PURSUIT_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";
import { fmtMoney, type Currency } from "@/lib/money";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";
import { leadSourceModule, type SourceModule } from "@/lib/moduleSource";
import { ModuleBreakdownTable, type ModuleBreakdownRow } from "@/components/ModuleBreakdown";
import { BUYER_CALL_ACTIVITY_TYPES, BUYER_CONNECTED_ACTIVITY_TYPES } from "@/lib/dashboardWidgets";

export const dynamic = "force-dynamic";

// §9.X — Multi-team comparison report (Dubai vs India head-to-head).
//
// Why: Lalit runs two distinct sales pods (Dubai + India). Each has its own
// currency, its own targets, and slightly different mechanics (Dubai sells
// AED-denominated investment property, India sells INR primary-residential).
// Comparing them side-by-side surfaces *which pod is firing this period* and
// what the other pod can learn — without forcing apples-to-apples currency
// math.
//
// Scoping rule across this page:
//   "Team X" = leads where Lead.forwardedTeam = "X". This is the assignment-
//   level marker (set when a lead is forwarded to the team), not the
//   owning agent's profile — because some agents work cross-team.
//
// All numeric columns are computed independently per team. Pipeline value
// stays in the team's native currency (AED for Dubai, INR for India) — we
// never sum them together, because mixed-currency totals lie.

const TEAMS = ["Dubai", "India"] as const;
type Team = (typeof TEAMS)[number];

const TEAM_CURRENCY: Record<Team, Currency> = {
  Dubai: "AED",
  India: "INR",
};

// Pipeline = active deal value, weighted-free (raw budgetMin sum across
// in-flight stages). Matches what Lalit reads on the dashboard "pipeline" tile.
// Status-only — active pursuit leads and booked leads.
const ACTIVE_STAGES = ACTIVE_PURSUIT_STATUSES;
const BOOKINGS = BOOKED_STATUSES;

// Date controls migrated to the shared ReportDateRangePicker (?from=&to=).
// Legacy ?range= is still parsed for one release so old bookmarks still
// load on a sensible window; from/to win when both are present.
type RangeKey = "30d" | "90d" | "year";
function legacyRangeStart(key: RangeKey): Date {
  const now = new Date();
  if (key === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  const days = key === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}
function parseLegacyRange(raw: string | undefined): RangeKey {
  if (raw === "90d" || raw === "year") return raw;
  return "30d";
}

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

// Per-module (Leads · Master Data · Revival Engine) tally. Buyer modules are
// carried as 0 (buyers are a separate report) so the type matches SourceModule.
type Triple = Record<SourceModule, number>;
function zeroTriple(): Triple {
  return { "Leads": 0, "Master Data": 0, "Revival Engine": 0, "Dubai Buyer Data": 0, "India Buyer Data": 0 };
}
/** Fold [leadOrigin, isColdCall] groupBy rows into a per-module triple. Each
 *  lead classifies into exactly one module → the triple sums to the flat count. */
function foldTriple(rows: Array<{ leadOrigin: string | null; isColdCall: boolean | null; _count: { _all: number } }>): Triple {
  const t = zeroTriple();
  for (const r of rows) t[leadSourceModule(r.leadOrigin, r.isColdCall)] += r._count._all;
  return t;
}

interface TeamMetrics {
  team: Team;
  currency: Currency;
  newLeads: number;
  activeLeads: number;
  callsMade: number;
  connectRate: number;     // 0..1
  avgFirstCallMins: number | null;
  meetingsBooked: number;
  siteVisitsDone: number;
  bookingsDone: number;
  pipelineValue: number;   // in team's native currency
  coldRevivals: number;
  avgAiScore: number | null;
  // ADDITIVE module split of the three pure lead-count metrics. Each triple
  // sums to its flat metric above (newLeads / activeLeads / bookingsDone).
  moduleSplit: { newLeads: Triple; activeLeads: Triple; bookingsDone: Triple };
}

async function computeTeamMetrics(team: Team, since: Date, until: Date): Promise<TeamMetrics> {
  // forwardedTeam is the canonical team marker (set at assignment time);
  // call/activity queries scope via the join because CallLog/Activity have
  // no team column of their own — they inherit from the lead.
  const leadWhere: Prisma.LeadWhereInput = { forwardedTeam: team, deletedAt: null };
  const callWhere: Prisma.CallLogWhereInput = { lead: { forwardedTeam: team, deletedAt: null } };
  const actWhere: Prisma.ActivityWhereInput = { lead: { forwardedTeam: team, deletedAt: null } };

  const [
    newLeads,
    activeLeads,
    leadCallsMade,
    leadCallsConnected,
    meetingsBooked,
    siteVisitsDone,
    bookingsDone,
    pipelineRows,
    coldRevivals,
    aiAvgRow,
    firstCallRows,
    newLeadsSplitRows,
    activeLeadsSplitRows,
    bookingsSplitRows,
    buyerCallsMade,
    buyerCallsConnected,
  ] = await Promise.all([
    // NEW leads in window — anything created in-range belonging to this team.
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: since, lte: until } } }),

    // ACTIVE leads — currently in any in-flight stage. Independent of the
    // window — "active right now" is a snapshot, not a flow metric.
    prisma.lead.count({ where: { ...leadWhere, currentStatus: { in: ACTIVE_STAGES } } }),

    // Calls made in-window.
    prisma.callLog.count({ where: { ...callWhere, startedAt: { gte: since, lte: until } } }),

    // Calls connected in-window — used as numerator for connect rate.
    prisma.callLog.count({
      where: { ...callWhere, startedAt: { gte: since, lte: until }, outcome: CallOutcome.CONNECTED },
    }),

    // Meetings BOOKED in-window — scheduledAt within range, any future or
    // past meeting type (office / virtual / home / expo).
    // "Booked" ≠ "done" — we count the act of scheduling.
    prisma.activity.count({
      where: {
        ...actWhere,
        type: {
          in: [
            ActivityType.OFFICE_MEETING,
            ActivityType.VIRTUAL_MEETING,
            ActivityType.HOME_VISIT,
            ActivityType.EXPO_MEETING,
          ],
        },
        scheduledAt: { gte: since, lte: until },
      },
    }),

    // Site visits DONE in-window — completedAt timestamp inside range.
    prisma.activity.count({
      where: {
        ...actWhere,
        type: ActivityType.SITE_VISIT,
        completedAt: { gte: since, lte: until },
      },
    }),

    // Bookings done — Lead moved into BOOKING_DONE/WON inside window.
    // bookingDoneAt is the precise marker for BOOKING_DONE; for WON we fall
    // back to updatedAt (status-change timestamp isn't stored on the lead).
    // OR'd so we don't miss either path.
    prisma.lead.count({
      where: {
        ...leadWhere,
        currentStatus: { in: [...BOOKINGS] },
        OR: [
          { bookingDoneAt: { gte: since, lte: until } },
          { updatedAt: { gte: since, lte: until } },
        ],
      },
    }),

    // Pipeline value — sum of budgetMin across active leads, currency-filtered
    // so a stray cross-currency lead doesn't pollute the team total.
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        currentStatus: { in: ACTIVE_STAGES },
        budgetCurrency: TEAM_CURRENCY[team],
      },
      select: { budgetMin: true },
    }),

    // Cold revivals — agent promoted a cold-data row into a real lead.
    // Activity.type = COLD_TO_LEAD fires once per promotion, completedAt
    // is set at log time.
    prisma.activity.count({
      where: {
        ...actWhere,
        type: ActivityType.COLD_TO_LEAD,
        completedAt: { gte: since, lte: until },
      },
    }),

    // Avg AI score — only over leads created in-window with a numeric score.
    // null safe: _avg returns null if no rows match.
    prisma.lead.aggregate({
      where: { ...leadWhere, createdAt: { gte: since, lte: until }, aiScoreValue: { not: null } },
      _avg: { aiScoreValue: true },
    }),

    // Avg first-call response time — minutes from lead.createdAt to the
    // earliest CallLog for that lead. Same DISTINCT-ON pattern used in
    // /reports/sources. Bounded by the window on lead.createdAt so we
    // measure "how fast did we respond to leads that arrived in this period".
    // Param-bound `since` + `team` — never string-interpolate.
    prisma.$queryRaw<Array<{ avg_mins: number | null }>>`
      WITH first_call AS (
        SELECT DISTINCT ON (cl."leadId")
               cl."leadId" AS lead_id,
               cl."startedAt" AS first_call_at
        FROM "CallLog" cl
        WHERE cl."leadId" IS NOT NULL
        ORDER BY cl."leadId", cl."startedAt" ASC
      )
      SELECT AVG(EXTRACT(EPOCH FROM (fc.first_call_at - l."createdAt")) / 60.0) AS avg_mins
      FROM "Lead" l
      JOIN first_call fc ON fc.lead_id = l."id"
      WHERE l."createdAt" >= ${since}
        AND l."createdAt" <= ${until}
        AND l."deletedAt" IS NULL
        AND l."forwardedTeam" = ${team}
        AND fc.first_call_at >= l."createdAt"
    `,

    // ── Module-split groupBys — SAME where clauses as newLeads / activeLeads /
    // bookingsDone above, with leadOrigin + isColdCall added so each combo row
    // classifies into its module. Sum over the combos == the flat count, so the
    // split reconciles 1:1 with the head-to-head figures.
    prisma.lead.groupBy({
      by: ["leadOrigin", "isColdCall"],
      where: { ...leadWhere, createdAt: { gte: since, lte: until } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["leadOrigin", "isColdCall"],
      where: { ...leadWhere, currentStatus: { in: ACTIVE_STAGES } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["leadOrigin", "isColdCall"],
      where: {
        ...leadWhere,
        currentStatus: { in: [...BOOKINGS] },
        OR: [
          { bookingDoneAt: { gte: since, lte: until } },
          { updatedAt: { gte: since, lte: until } },
        ],
      },
      _count: { _all: true },
    }),

    // Buyer-Data calls for this team — a team's buyer calls = BuyerActivity whose
    // buyer.market equals the team ("Dubai"/"India" == market value). Sourced from
    // BuyerActivity ONLY (each buyer call counted once); the CallLog query above is
    // lead-scoped (lead:{...}) so it already excludes buyer CallLog rows — we just
    // ADD these. Same window as callsMade (startedAt gte/lte → createdAt gte/lte),
    // live buyers only. (Lalit 2026-07-08)
    prisma.buyerActivity.count({
      where: {
        type: { in: BUYER_CALL_ACTIVITY_TYPES },
        createdAt: { gte: since, lte: until },
        buyer: { market: team, deletedAt: null },
      },
    }),

    // Connected Buyer-Data calls (BUYER_CONNECTED_ACTIVITY_TYPES = CALL only) — added
    // to callsConnected so connectRate stays connected/total over the new totals.
    prisma.buyerActivity.count({
      where: {
        type: { in: BUYER_CONNECTED_ACTIVITY_TYPES },
        createdAt: { gte: since, lte: until },
        buyer: { market: team, deletedAt: null },
      },
    }),
  ]);

  // Fold Buyer-Data calls into the team call totals (lead calls above already exclude
  // buyer CallLog rows via the lead-scoped where; buyer calls come only from BuyerActivity).
  const callsMade = leadCallsMade + buyerCallsMade;
  const callsConnected = leadCallsConnected + buyerCallsConnected;

  const pipelineValue = pipelineRows.reduce((s, r) => s + (r.budgetMin ?? 0), 0);
  const connectRate = callsMade > 0 ? callsConnected / callsMade : 0;
  const avgFirstCallMins =
    firstCallRows[0]?.avg_mins == null ? null : Number(firstCallRows[0].avg_mins);
  const avgAiScore = aiAvgRow._avg.aiScoreValue;

  return {
    team,
    currency: TEAM_CURRENCY[team],
    newLeads,
    activeLeads,
    callsMade,
    connectRate,
    avgFirstCallMins,
    meetingsBooked,
    siteVisitsDone,
    bookingsDone,
    pipelineValue,
    coldRevivals,
    avgAiScore,
    moduleSplit: {
      newLeads: foldTriple(newLeadsSplitRows),
      activeLeads: foldTriple(activeLeadsSplitRows),
      bookingsDone: foldTriple(bookingsSplitRows),
    },
  };
}

// Weighted composite — used only to crown the overall winner.
// Weights per spec: bookings 50% + pipeline 30% + connect rate 20%.
// We normalize each metric to a 0..1 score (each team gets a share of the
// pair's total) so the result is a unitless composite. The team with the
// higher composite wins.
function compositeScore(a: TeamMetrics, b: TeamMetrics): { a: number; b: number } {
  // Pipeline can't be summed across currencies; instead we use each team's
  // *rank* in the pair (share-of-sum within own units).
  const aBook = a.bookingsDone;
  const bBook = b.bookingsDone;
  const bookShareA = aBook + bBook > 0 ? aBook / (aBook + bBook) : 0.5;
  const bookShareB = 1 - bookShareA;

  // Pipeline share — currency-agnostic by virtue of being a ratio.
  // We compare a team's own pipeline to its *own potential* via a simple
  // pairwise normalization: each team's score = pipeline / max(pipelineA, pipelineB).
  // That avoids ever adding AED + INR together. Tie → 0.5 each.
  const maxPipe = Math.max(a.pipelineValue, b.pipelineValue);
  const pipeA = maxPipe > 0 ? a.pipelineValue / maxPipe : 0.5;
  const pipeB = maxPipe > 0 ? b.pipelineValue / maxPipe : 0.5;
  // Pipe needs to be share-style (sum to 1) so weights line up with the
  // others. Re-normalize.
  const pipeSum = pipeA + pipeB || 1;
  const pipeShareA = pipeA / pipeSum;
  const pipeShareB = pipeB / pipeSum;

  // Connect rate share — same pairwise share approach.
  const crSum = a.connectRate + b.connectRate;
  const crShareA = crSum > 0 ? a.connectRate / crSum : 0.5;
  const crShareB = 1 - crShareA;

  const scoreA = 0.5 * bookShareA + 0.3 * pipeShareA + 0.2 * crShareA;
  const scoreB = 0.5 * bookShareB + 0.3 * pipeShareB + 0.2 * crShareB;
  return { a: scoreA, b: scoreB };
}

// Format helpers ─────────────────────────────────────────────────────────

function fmtPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function fmtMins(v: number | null): string {
  if (v == null) return "—";
  if (v < 1) return "<1 min";
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
function fmtScore(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}`;
}

// Delta arrow — green up if this team is ahead, red down if behind.
// For "lower is better" metrics (avgFirstCallMins) we invert the comparison.
type Direction = "higher_is_better" | "lower_is_better";
function deltaCell(
  self: number | null,
  other: number | null,
  dir: Direction,
): { label: string; cls: string } {
  if (self == null || other == null) return { label: "—", cls: "text-gray-400" };
  if (self === other) return { label: "= even", cls: "text-gray-500" };
  const ahead = dir === "higher_is_better" ? self > other : self < other;
  const diff = Math.abs(self - other);
  // Pretty-print the diff with whatever scale the metric uses. We choose
  // a sensible fallback: integers stay integers, fractions get 1 decimal.
  const diffLabel = Number.isInteger(self) && Number.isInteger(other)
    ? `${diff.toLocaleString()}`
    : diff.toFixed(1);
  return {
    label: ahead ? `▲ ${diffLabel}` : `▼ ${diffLabel}`,
    cls: ahead ? "text-emerald-600" : "text-rose-600",
  };
}

// For pipeline value we can't compare across currencies, so the delta is
// rendered as a ratio (e.g. "▲ 1.4× their pipeline (own currency)") which
// is unitless. Same for connect rate (a ratio already).
function pipelineDelta(self: number, other: number): { label: string; cls: string } {
  if (self === 0 && other === 0) return { label: "—", cls: "text-gray-400" };
  if (other === 0) return { label: "▲ only team with pipeline", cls: "text-emerald-600" };
  if (self === 0) return { label: "▼ no pipeline yet", cls: "text-rose-600" };
  const ratio = self / other;
  if (ratio >= 1) return { label: `▲ ${ratio.toFixed(2)}× theirs`, cls: "text-emerald-600" };
  return { label: `▼ ${ratio.toFixed(2)}× theirs`, cls: "text-rose-600" };
}

export default async function TeamComparisonReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;

  // Resolve window. ?from=&to= win; otherwise fall back to legacy ?range=
  // (one release of backwards-compat), defaulting to last 30 days.
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  let since: Date;
  let until: Date;
  if (fromParam && toParam) {
    since = fromParam;
    until = endOfDayUtc(toParam);
  } else {
    const legacy = parseLegacyRange(sp.range);
    since = legacyRangeStart(legacy);
    until = endOfDayUtc(new Date());
  }
  const rangeLabel = `${toYmd(since)} → ${toYmd(until)}`;

  // MANAGER sees only their own team; ADMIN sees both in a head-to-head comparison.
  const teamsToCompute: Array<"Dubai" | "India"> =
    managerTeam === "Dubai" ? ["Dubai"]
    : managerTeam === "India" ? ["India"]
    : ["Dubai", "India"];

  const teamResults = await Promise.all(teamsToCompute.map((t) => computeTeamMetrics(t, since, until)));
  const dubai = teamsToCompute.includes("Dubai") ? teamResults[teamsToCompute.indexOf("Dubai")] : null;
  const india = teamsToCompute.includes("India") ? teamResults[teamsToCompute.indexOf("India")] : null;

  // Winner banner only makes sense when both teams are visible (ADMIN).
  const composite = dubai && india ? compositeScore(dubai, india) : null;
  const winner: Team | null =
    composite == null ? null :
    composite.a === composite.b ? "Dubai" : composite.a > composite.b ? "Dubai" : "India";
  const isDraw = composite != null && composite.a === composite.b;

  // Build per-row cell data once so the JSX stays readable.
  // Each row: label, dubai value (rendered), india value (rendered), and
  // delta direction the table uses to color the arrows.
  // For MANAGER (only one team available), delta cells show "—".
  interface Row {
    label: string;
    note?: string;
    dubaiValue: string;
    indiaValue: string;
    delta: { dubai: { label: string; cls: string }; india: { label: string; cls: string } };
    /** Optional drill-down hrefs — set ONLY when a /leads URL reproduces the
     *  metric's exact where-clause (count == records). Rendered as a Link. */
    dubaiHref?: string;
    indiaHref?: string;
  }

  // Drill for "Active leads" — the one metric here whose where-clause is exactly
  // URL-expressible: forwardedTeam + deletedAt:null + currentStatus IN
  // ACTIVE_PURSUIT_STATUSES, any origin, no date window (snapshot).
  //   • showCold=1  → drops /leads' cold exclusion (the count includes revival-origin actives)
  //   • seg=all     → admin's /leads defaults to "My Leads"; the count is team-wide
  //   • cstatus=…   → the EXACT ACTIVE_STAGES in-list; bypasses the workable envelope
  //   • followup=all→ no follow-up narrowing (explicit, immune to default changes)
  // Every other row is window-bound / cross-ledger / an aggregate — see the
  // drill-audit notes; those stay unlinked rather than pointing at a wrong list.
  const activeLeadsDrill = (team: Team): string => {
    const p = new URLSearchParams({
      showCold: "1",
      seg: "all",
      team,
      cstatus: ACTIVE_STAGES.join(","),
      followup: "all",
    });
    return `/leads?${p.toString()}`;
  };

  const noVal = { label: "—", cls: "text-gray-400" };

  const numericDelta = (a: number | null, b: number | null, dir: Direction) =>
    a !== null && b !== null
      ? { dubai: deltaCell(a, b, dir), india: deltaCell(b, a, dir) }
      : { dubai: noVal, india: noVal };

  const rows: Row[] = [
    {
      label: "New leads",
      dubaiValue: dubai ? dubai.newLeads.toLocaleString() : "—",
      indiaValue: india ? india.newLeads.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.newLeads : null, india ? india.newLeads : null, "higher_is_better"),
    },
    {
      label: "Active leads",
      note: "currently in NEW → NEGOTIATION (snapshot, not window-bound)",
      dubaiValue: dubai ? dubai.activeLeads.toLocaleString() : "—",
      indiaValue: india ? india.activeLeads.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.activeLeads : null, india ? india.activeLeads : null, "higher_is_better"),
      dubaiHref: dubai ? activeLeadsDrill("Dubai") : undefined,
      indiaHref: india ? activeLeadsDrill("India") : undefined,
    },
    {
      label: "Calls made",
      dubaiValue: dubai ? dubai.callsMade.toLocaleString() : "—",
      indiaValue: india ? india.callsMade.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.callsMade : null, india ? india.callsMade : null, "higher_is_better"),
    },
    {
      label: "Connect rate",
      note: "connected / total calls",
      dubaiValue: dubai ? fmtPct(dubai.connectRate) : "—",
      indiaValue: india ? fmtPct(india.connectRate) : "—",
      delta: numericDelta(dubai ? dubai.connectRate : null, india ? india.connectRate : null, "higher_is_better"),
    },
    {
      label: "Avg first-call response",
      note: "lead created → first CallLog (lower is better)",
      dubaiValue: dubai ? fmtMins(dubai.avgFirstCallMins) : "—",
      indiaValue: india ? fmtMins(india.avgFirstCallMins) : "—",
      delta: {
        dubai: dubai && india ? deltaCell(dubai.avgFirstCallMins, india.avgFirstCallMins, "lower_is_better") : noVal,
        india: dubai && india ? deltaCell(india.avgFirstCallMins, dubai.avgFirstCallMins, "lower_is_better") : noVal,
      },
    },
    {
      label: "Meetings booked",
      note: "office + virtual + home + expo, scheduled in-window",
      dubaiValue: dubai ? dubai.meetingsBooked.toLocaleString() : "—",
      indiaValue: india ? india.meetingsBooked.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.meetingsBooked : null, india ? india.meetingsBooked : null, "higher_is_better"),
    },
    {
      label: "Site visits done",
      dubaiValue: dubai ? dubai.siteVisitsDone.toLocaleString() : "—",
      indiaValue: india ? india.siteVisitsDone.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.siteVisitsDone : null, india ? india.siteVisitsDone : null, "higher_is_better"),
    },
    {
      label: "Bookings done",
      note: "BOOKING_DONE or WON in-window",
      dubaiValue: dubai ? dubai.bookingsDone.toLocaleString() : "—",
      indiaValue: india ? india.bookingsDone.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.bookingsDone : null, india ? india.bookingsDone : null, "higher_is_better"),
    },
    {
      label: "Pipeline value",
      note: "active deals in team's native currency — never summed across teams",
      dubaiValue: dubai ? fmtMoney(dubai.pipelineValue, dubai.currency) : "—",
      indiaValue: india ? fmtMoney(india.pipelineValue, india.currency) : "—",
      delta: {
        dubai: dubai && india ? pipelineDelta(dubai.pipelineValue, india.pipelineValue) : noVal,
        india: dubai && india ? pipelineDelta(india.pipelineValue, dubai.pipelineValue) : noVal,
      },
    },
    {
      label: "Cold revivals",
      note: "COLD_TO_LEAD activities in-window",
      dubaiValue: dubai ? dubai.coldRevivals.toLocaleString() : "—",
      indiaValue: india ? india.coldRevivals.toLocaleString() : "—",
      delta: numericDelta(dubai ? dubai.coldRevivals : null, india ? india.coldRevivals : null, "higher_is_better"),
    },
    {
      label: "Avg AI score",
      note: "0-100, leads created in-window",
      dubaiValue: dubai ? fmtScore(dubai.avgAiScore) : "—",
      indiaValue: india ? fmtScore(india.avgAiScore) : "—",
      delta: {
        dubai: dubai && india ? deltaCell(dubai.avgAiScore, india.avgAiScore, "higher_is_better") : noVal,
        india: dubai && india ? deltaCell(india.avgAiScore, dubai.avgAiScore, "higher_is_better") : noVal,
      },
    },
  ];

  // For the "winner banner" we also surface the composite shares so Lalit
  // can see *how decisive* the call is. Close races (within 5pp) get a
  // softer "edges out" verb.
  const aPct = composite ? Math.round(composite.a * 100) : 0;
  const bPct = composite ? Math.round(composite.b * 100) : 0;
  const margin = Math.abs(aPct - bPct);
  const verb = margin <= 5 ? "edges out" : margin <= 15 ? "leads" : "dominates";

  return (
    <>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Team Comparison</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {managerTeam ? `${managerTeam} team · ${rangeLabel}` : `Dubai vs India · head-to-head · ${rangeLabel}`}
          </p>
        </div>
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
      </div>

      {/* Shared date-range picker — replaces the previous ?range= anchor links.
          Reads & writes ?from=&to= and exposes the standard preset chips. */}
      <ReportDateRangePicker defaultFrom={toYmd(since)} defaultTo={toYmd(until)} />

      {/* Winner banner — only shown when ADMIN (both teams visible). */}
      {composite && (
      <div
        className={`card p-4 border-l-4 ${
          isDraw
            ? "border-gray-400"
            : winner === "Dubai"
            ? "border-amber-500 bg-amber-50/30"
            : "border-emerald-500 bg-emerald-50/30"
        }`}
      >
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">
          🏆 Winner overall · {rangeLabel}
        </div>
        {isDraw ? (
          <div className="text-xl sm:text-2xl font-extrabold mt-1">
            Dead heat — {aPct}% vs {bPct}%
          </div>
        ) : (
          <div className="text-xl sm:text-2xl font-extrabold mt-1">
            Winner overall: {winner}{" "}
            <span className="text-sm font-semibold text-gray-600">
              · {winner} {verb} {winner === "Dubai" ? "India" : "Dubai"}
            </span>
          </div>
        )}
        <div className="text-[11px] text-gray-600 mt-1">
          Weighted composite — Dubai {aPct}% · India {bPct}% · weights:
          bookings 50% + pipeline 30% + connect rate 20%
        </div>
      </div>
      )}

      {/* Head-to-head table — metric, Dubai value+delta, India value+delta.
          For MANAGER with a single team, the other team's column shows "—". */}
      <div className="card p-0 overflow-hidden">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] sm:grid-cols-[1.6fr_1fr_1fr] bg-gray-50 border-b text-[11px] uppercase tracking-widest text-gray-500 font-semibold">
          <div className="px-3 py-2">Metric</div>
          <div className="px-3 py-2 text-right">
            <span className="inline-flex items-center gap-1">
              🇦🇪 Dubai
              <span className="text-[10px] font-normal text-gray-400">(AED)</span>
            </span>
          </div>
          <div className="px-3 py-2 text-right">
            <span className="inline-flex items-center gap-1">
              🇮🇳 India
              <span className="text-[10px] font-normal text-gray-400">(INR)</span>
            </span>
          </div>
        </div>

        <div className="divide-y">
          {rows.map((r) => (
            <div
              key={r.label}
              className="grid grid-cols-[1.4fr_1fr_1fr] sm:grid-cols-[1.6fr_1fr_1fr] items-start text-sm"
            >
              <div className="px-3 py-2.5">
                <div className="font-medium">{r.label}</div>
                {r.note && (
                  <div className="text-[10px] text-gray-500 leading-snug">{r.note}</div>
                )}
              </div>
              <div className="px-3 py-2.5 text-right">
                {r.dubaiHref ? (
                  <Link href={r.dubaiHref} title="Open the exact leads behind this number" className="font-semibold tabular-nums underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 inline-block">{r.dubaiValue}</Link>
                ) : (
                  <div className="font-semibold tabular-nums">{r.dubaiValue}</div>
                )}
                <div className={`text-[10px] tabular-nums ${r.delta.dubai.cls}`}>
                  {r.delta.dubai.label}
                </div>
              </div>
              <div className="px-3 py-2.5 text-right">
                {r.indiaHref ? (
                  <Link href={r.indiaHref} title="Open the exact leads behind this number" className="font-semibold tabular-nums underline decoration-dotted underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300 inline-block">{r.indiaValue}</Link>
                ) : (
                  <div className="font-semibold tabular-nums">{r.indiaValue}</div>
                )}
                <div className={`text-[10px] tabular-nums ${r.delta.india.cls}`}>
                  {r.delta.india.label}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Module (source_module) breakdown — per team, the three pure
          lead-count metrics split across Leads · Master Data · Revival Engine.
          Additive: each row's Total equals the head-to-head figure above. */}
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Module breakdown · Leads · Master Data · Revival Engine · {rangeLabel}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[dubai, india].filter((t): t is TeamMetrics => t != null).map((t) => {
            const mrows: ModuleBreakdownRow[] = [
              { label: "New leads", counts: t.moduleSplit.newLeads, total: t.newLeads },
              { label: "Active leads", counts: t.moduleSplit.activeLeads, total: t.activeLeads },
              { label: "Bookings done", counts: t.moduleSplit.bookingsDone, total: t.bookingsDone },
            ];
            return (
              <div key={t.team}>
                <div className="text-[11px] font-semibold text-gray-600 mb-1">
                  {t.team === "Dubai" ? "🇦🇪 Dubai" : "🇮🇳 India"}
                </div>
                <ModuleBreakdownTable rows={mrows} showZeroRows minWidth={420} metricHeader="Metric" />
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-500 mt-3">
          Only the three pure lead-count metrics carry a module split (New leads · Active leads · Bookings done). Each total = Leads + Master Data + Revival Engine. Calls, meetings, pipeline value and rates are not per-lead counts and are left unsplit.
        </p>
      </div>

      <div className="text-[10px] text-gray-500 leading-relaxed">
        Notes — Pipeline value stays in each team&apos;s native currency;
        we never sum AED + INR. Pipeline delta is shown as a ratio (×) for the
        same reason. Avg first-call response is the only metric where{" "}
        <span className="font-semibold">lower is better</span>; all other deltas
        treat higher as winning. Team membership uses{" "}
        <code className="bg-gray-100 px-1 rounded">Lead.forwardedTeam</code>,
        not the owning agent&apos;s profile team.
      </div>
    </>
  );
}

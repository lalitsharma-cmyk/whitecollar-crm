import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ActivityType, CallOutcome, LeadStatus, Prisma } from "@prisma/client";
import { fmtMoney, type Currency } from "@/lib/money";
import Link from "next/link";

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
const ACTIVE_STAGES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.SITE_VISIT,
  LeadStatus.NEGOTIATION,
];

// "Bookings done" — anything that crossed the line. BOOKING_DONE or WON.
const BOOKINGS: LeadStatus[] = [LeadStatus.BOOKING_DONE, LeadStatus.WON];

type RangeKey = "30d" | "90d" | "year";
const RANGE_LABEL: Record<RangeKey, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "year": "Year to date",
};
function rangeStart(key: RangeKey): Date {
  const now = new Date();
  if (key === "year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  const days = key === "30d" ? 30 : 90;
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}
function parseRange(raw: string | undefined): RangeKey {
  if (raw === "90d" || raw === "year") return raw;
  return "30d";
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
}

async function computeTeamMetrics(team: Team, since: Date): Promise<TeamMetrics> {
  // forwardedTeam is the canonical team marker (set at assignment time);
  // call/activity queries scope via the join because CallLog/Activity have
  // no team column of their own — they inherit from the lead.
  const leadWhere: Prisma.LeadWhereInput = { forwardedTeam: team };
  const callWhere: Prisma.CallLogWhereInput = { lead: { forwardedTeam: team } };
  const actWhere: Prisma.ActivityWhereInput = { lead: { forwardedTeam: team } };

  const [
    newLeads,
    activeLeads,
    callsMade,
    callsConnected,
    meetingsBooked,
    siteVisitsDone,
    bookingsDone,
    pipelineRows,
    coldRevivals,
    aiAvgRow,
    firstCallRows,
  ] = await Promise.all([
    // NEW leads in window — anything created in-range belonging to this team.
    prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: since } } }),

    // ACTIVE leads — currently in any in-flight stage. Independent of the
    // window — "active right now" is a snapshot, not a flow metric.
    prisma.lead.count({ where: { ...leadWhere, status: { in: ACTIVE_STAGES } } }),

    // Calls made in-window.
    prisma.callLog.count({ where: { ...callWhere, startedAt: { gte: since } } }),

    // Calls connected in-window — used as numerator for connect rate.
    prisma.callLog.count({
      where: { ...callWhere, startedAt: { gte: since }, outcome: CallOutcome.CONNECTED },
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
        scheduledAt: { gte: since },
      },
    }),

    // Site visits DONE in-window — completedAt timestamp inside range.
    prisma.activity.count({
      where: {
        ...actWhere,
        type: ActivityType.SITE_VISIT,
        completedAt: { gte: since },
      },
    }),

    // Bookings done — Lead moved into BOOKING_DONE/WON inside window.
    // bookingDoneAt is the precise marker for BOOKING_DONE; for WON we fall
    // back to updatedAt (status-change timestamp isn't stored on the lead).
    // OR'd so we don't miss either path.
    prisma.lead.count({
      where: {
        ...leadWhere,
        status: { in: BOOKINGS },
        OR: [
          { bookingDoneAt: { gte: since } },
          { updatedAt: { gte: since } },
        ],
      },
    }),

    // Pipeline value — sum of budgetMin across active leads, currency-filtered
    // so a stray cross-currency lead doesn't pollute the team total.
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        status: { in: ACTIVE_STAGES },
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
        completedAt: { gte: since },
      },
    }),

    // Avg AI score — only over leads created in-window with a numeric score.
    // null safe: _avg returns null if no rows match.
    prisma.lead.aggregate({
      where: { ...leadWhere, createdAt: { gte: since }, aiScoreValue: { not: null } },
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
        AND l."forwardedTeam" = ${team}
        AND fc.first_call_at >= l."createdAt"
    `,
  ]);

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
  await requireRole("ADMIN", "MANAGER");
  const sp = await searchParams;
  const rangeKey = parseRange(sp.range);
  const since = rangeStart(rangeKey);

  // Two team queries in parallel — `Promise.all` at this layer ensures Dubai
  // and India hit the DB concurrently; each `computeTeamMetrics` already
  // parallelises its own sub-queries via `Promise.all`.
  const [dubai, india] = await Promise.all([
    computeTeamMetrics("Dubai", since),
    computeTeamMetrics("India", since),
  ]);

  const composite = compositeScore(dubai, india);
  const winner: Team =
    composite.a === composite.b ? "Dubai" : composite.a > composite.b ? "Dubai" : "India";
  const isDraw = composite.a === composite.b;

  // Build per-row cell data once so the JSX stays readable.
  // Each row: label, dubai value (rendered), india value (rendered), and
  // delta direction the table uses to color the arrows.
  interface Row {
    label: string;
    note?: string;
    dubaiValue: string;
    indiaValue: string;
    delta: { dubai: { label: string; cls: string }; india: { label: string; cls: string } };
  }

  const numericDelta = (a: number, b: number, dir: Direction) => ({
    dubai: deltaCell(a, b, dir),
    india: deltaCell(b, a, dir),
  });

  const rows: Row[] = [
    {
      label: "New leads",
      dubaiValue: dubai.newLeads.toLocaleString(),
      indiaValue: india.newLeads.toLocaleString(),
      delta: numericDelta(dubai.newLeads, india.newLeads, "higher_is_better"),
    },
    {
      label: "Active leads",
      note: "currently in NEW → NEGOTIATION (snapshot, not window-bound)",
      dubaiValue: dubai.activeLeads.toLocaleString(),
      indiaValue: india.activeLeads.toLocaleString(),
      delta: numericDelta(dubai.activeLeads, india.activeLeads, "higher_is_better"),
    },
    {
      label: "Calls made",
      dubaiValue: dubai.callsMade.toLocaleString(),
      indiaValue: india.callsMade.toLocaleString(),
      delta: numericDelta(dubai.callsMade, india.callsMade, "higher_is_better"),
    },
    {
      label: "Connect rate",
      note: "connected / total calls",
      dubaiValue: fmtPct(dubai.connectRate),
      indiaValue: fmtPct(india.connectRate),
      delta: numericDelta(dubai.connectRate, india.connectRate, "higher_is_better"),
    },
    {
      label: "Avg first-call response",
      note: "lead created → first CallLog (lower is better)",
      dubaiValue: fmtMins(dubai.avgFirstCallMins),
      indiaValue: fmtMins(india.avgFirstCallMins),
      delta: {
        dubai: deltaCell(dubai.avgFirstCallMins, india.avgFirstCallMins, "lower_is_better"),
        india: deltaCell(india.avgFirstCallMins, dubai.avgFirstCallMins, "lower_is_better"),
      },
    },
    {
      label: "Meetings booked",
      note: "office + virtual + home + expo, scheduled in-window",
      dubaiValue: dubai.meetingsBooked.toLocaleString(),
      indiaValue: india.meetingsBooked.toLocaleString(),
      delta: numericDelta(dubai.meetingsBooked, india.meetingsBooked, "higher_is_better"),
    },
    {
      label: "Site visits done",
      dubaiValue: dubai.siteVisitsDone.toLocaleString(),
      indiaValue: india.siteVisitsDone.toLocaleString(),
      delta: numericDelta(dubai.siteVisitsDone, india.siteVisitsDone, "higher_is_better"),
    },
    {
      label: "Bookings done",
      note: "BOOKING_DONE or WON in-window",
      dubaiValue: dubai.bookingsDone.toLocaleString(),
      indiaValue: india.bookingsDone.toLocaleString(),
      delta: numericDelta(dubai.bookingsDone, india.bookingsDone, "higher_is_better"),
    },
    {
      label: "Pipeline value",
      note: "active deals in team's native currency — never summed across teams",
      dubaiValue: fmtMoney(dubai.pipelineValue, dubai.currency),
      indiaValue: fmtMoney(india.pipelineValue, india.currency),
      delta: {
        dubai: pipelineDelta(dubai.pipelineValue, india.pipelineValue),
        india: pipelineDelta(india.pipelineValue, dubai.pipelineValue),
      },
    },
    {
      label: "Cold revivals",
      note: "COLD_TO_LEAD activities in-window",
      dubaiValue: dubai.coldRevivals.toLocaleString(),
      indiaValue: india.coldRevivals.toLocaleString(),
      delta: numericDelta(dubai.coldRevivals, india.coldRevivals, "higher_is_better"),
    },
    {
      label: "Avg AI score",
      note: "0-100, leads created in-window",
      dubaiValue: fmtScore(dubai.avgAiScore),
      indiaValue: fmtScore(india.avgAiScore),
      delta: {
        dubai: deltaCell(dubai.avgAiScore, india.avgAiScore, "higher_is_better"),
        india: deltaCell(india.avgAiScore, dubai.avgAiScore, "higher_is_better"),
      },
    },
  ];

  // For the "winner banner" we also surface the composite shares so Lalit
  // can see *how decisive* the call is. Close races (within 5pp) get a
  // softer "edges out" verb.
  const aPct = Math.round(composite.a * 100);
  const bPct = Math.round(composite.b * 100);
  const margin = Math.abs(aPct - bPct);
  const verb = margin <= 5 ? "edges out" : margin <= 15 ? "leads" : "dominates";

  return (
    <>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Team Comparison</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Dubai vs India · head-to-head · {RANGE_LABEL[rangeKey]}
          </p>
        </div>
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
      </div>

      {/* Period selector — kept as plain anchor links (no JS) so the page
          stays a pure RSC. Each link sets ?range= and the server re-runs. */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-gray-500">Period:</span>
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => {
          const active = k === rangeKey;
          return (
            <Link
              key={k}
              href={`/reports/team-comparison?range=${k}`}
              className={`px-2.5 py-1 rounded-md border ${
                active
                  ? "bg-[#0b1a33] text-white border-[#0b1a33]"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
              }`}
            >
              {RANGE_LABEL[k]}
            </Link>
          );
        })}
      </div>

      {/* Winner banner — at-a-glance verdict driven by the weighted composite
          (bookings 50% + pipeline 30% + connect rate 20%). */}
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
          🏆 Winner overall · {RANGE_LABEL[rangeKey]}
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

      {/* Head-to-head table — 4 columns: metric, Dubai value+delta, India
          value+delta. Sticky-ish responsive layout: on mobile we collapse the
          notes under the metric label. */}
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
                <div className="font-semibold tabular-nums">{r.dubaiValue}</div>
                <div className={`text-[10px] tabular-nums ${r.delta.dubai.cls}`}>
                  {r.delta.dubai.label}
                </div>
              </div>
              <div className="px-3 py-2.5 text-right">
                <div className="font-semibold tabular-nums">{r.indiaValue}</div>
                <div className={`text-[10px] tabular-nums ${r.delta.india.cls}`}>
                  {r.delta.india.label}
                </div>
              </div>
            </div>
          ))}
        </div>
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

import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { LeadSource, LeadStatus } from "@prisma/client";
import { subDays, startOfYear, startOfMonth, startOfQuarter } from "date-fns";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";

export const dynamic = "force-dynamic";

// Lead Source Breakdown — answers "which sources are working?".
// One row per LeadSource enum value, columns expose the full funnel
// (received → contacted → qualified → booked / lost) plus two
// "operations" metrics — average minutes to the first call, and the
// average AI lead score. This lets Lalit redirect ad spend toward the
// source that converts, not just the source that produces volume.

// Date controls are now the shared ReportDateRangePicker (?from=&to=).
// Legacy ?range=30d|90d|year is still accepted for one release so old
// bookmarks / shared links don't 404 the period selector — if both are
// supplied, from/to win.

type Range = "30d" | "90d" | "year" | "month" | "quarter";

interface SourceRow {
  source: LeadSource;
  total: number;
  contacted: number;
  qualified: number;
  booked: number;
  lost: number;
  qualifiedPct: number;   // qualified / total * 100
  bookedPct: number;      // booked / total * 100
  avgFirstCallMins: number | null;
  avgAiScore: number | null;
}

// QUALIFIED-or-better — anything past the "we agreed they're worth chasing" line.
const QUALIFIED_PLUS: LeadStatus[] = [
  LeadStatus.QUALIFIED,
  LeadStatus.SITE_VISIT,
  LeadStatus.NEGOTIATION,
  LeadStatus.BOOKING_DONE,
  LeadStatus.WON,
];

// BOOKED — money on the table. WON kept here too because once a deal is WON
// the booking is by definition done; treating them together avoids a row
// where bookedPct is artificially deflated by leads that skipped BOOKING_DONE.
const BOOKED: LeadStatus[] = [LeadStatus.BOOKING_DONE, LeadStatus.WON];

// Legacy enum → since-date. Kept ONLY for backwards-compat parsing of the
// old ?range= URL: it lets us derive an initial from/to when the new
// ?from=&to= aren't present yet. Once a user lands on this page with the
// picker, they'll switch to the new params on Apply.
function rangeStart(range: Range): Date {
  if (range === "year") return startOfYear(new Date());
  if (range === "month") return startOfMonth(new Date());
  if (range === "quarter") return startOfQuarter(new Date());
  if (range === "30d") return subDays(new Date(), 30);
  return subDays(new Date(), 90);
}

// Strict YYYY-MM-DD → Date at UTC midnight. Rejects junk so a hand-edited
// URL doesn't end up gte: Invalid Date.
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

// Colour-code conversion-rate cells: >20% green, >10% amber, else red.
// Empty / "—" stays neutral grey so we don't shout about leads-with-no-data.
function pctClass(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return "bg-gray-50 text-gray-400";
  if (pct > 20) return "bg-emerald-50 text-emerald-800 font-semibold";
  if (pct > 10) return "bg-amber-50 text-amber-800 font-semibold";
  return "bg-rose-50 text-rose-800 font-semibold";
}

function fmtMins(m: number | null): string {
  if (m === null || Number.isNaN(m)) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m % 60);
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export default async function SourcesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;

  // Resolve the active window. Precedence:
  //   1. ?from=&to= (new shared-picker contract)  ← wins if present
  //   2. ?range=    (legacy enum — keep for one release)
  //   3. default = last 90 days (matches the previous page default)
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  let since: Date;
  let until: Date;
  if (fromParam && toParam) {
    since = fromParam;
    until = endOfDayUtc(toParam);
  } else {
    const legacyRange: Range =
      sp.range === "30d" || sp.range === "year" || sp.range === "month" || sp.range === "quarter"
        ? sp.range
        : "90d";
    since = rangeStart(legacyRange);
    until = endOfDayUtc(new Date());
  }

  // Header label is now derived from the window itself (no fixed enum).
  const rangeLabel = `${toYmd(since)} → ${toYmd(until)}`;

  // ── Pull all the aggregations in parallel.
  // Five Prisma groupBys + one $queryRaw — every query is bounded by
  // `since` and grouped by source so the DB does the heavy lifting.
  const [
    totalByGroup,
    contactedByGroup,
    qualifiedByGroup,
    bookedByGroup,
    lostByGroup,
    aiScoreByGroup,
    firstCallRows,
  ] = await Promise.all([
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, status: { not: LeadStatus.NEW }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, status: { in: QUALIFIED_PLUS }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, status: { in: BOOKED }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, status: LeadStatus.LOST, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since, lte: until }, aiScoreValue: { not: null }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      _avg: { aiScoreValue: true },
    }),

    // Average minutes from lead.createdAt to the FIRST CallLog for that
    // lead. DISTINCT ON picks the earliest CallLog per lead in one pass,
    // then we average the delta per source. EXTRACT(EPOCH FROM ...)/60
    // returns minutes as a number so we can pass it straight through.
    // Type guard: rows without a CallLog don't appear here, which is what
    // we want — we measure "speed when we DID respond", not "speed
    // including unresponded leads".
    managerTeam
      ? prisma.$queryRaw<Array<{ source: string; avg_mins: number | null }>>`
          WITH first_call AS (
            SELECT DISTINCT ON (cl."leadId")
                   cl."leadId" AS lead_id,
                   cl."startedAt" AS first_call_at
            FROM "CallLog" cl
            WHERE cl."leadId" IS NOT NULL
            ORDER BY cl."leadId", cl."startedAt" ASC
          )
          SELECT l."source"::text AS source,
                 AVG(EXTRACT(EPOCH FROM (fc.first_call_at - l."createdAt")) / 60.0) AS avg_mins
          FROM "Lead" l
          JOIN first_call fc ON fc.lead_id = l."id"
          WHERE l."createdAt" >= ${since}
            AND l."createdAt" <= ${until}
            AND l."forwardedTeam" = ${managerTeam}
            AND fc.first_call_at >= l."createdAt"
          GROUP BY l."source"
        `
      : prisma.$queryRaw<Array<{ source: string; avg_mins: number | null }>>`
          WITH first_call AS (
            SELECT DISTINCT ON (cl."leadId")
                   cl."leadId" AS lead_id,
                   cl."startedAt" AS first_call_at
            FROM "CallLog" cl
            WHERE cl."leadId" IS NOT NULL
            ORDER BY cl."leadId", cl."startedAt" ASC
          )
          SELECT l."source"::text AS source,
                 AVG(EXTRACT(EPOCH FROM (fc.first_call_at - l."createdAt")) / 60.0) AS avg_mins
          FROM "Lead" l
          JOIN first_call fc ON fc.lead_id = l."id"
          WHERE l."createdAt" >= ${since}
            AND l."createdAt" <= ${until}
            AND fc.first_call_at >= l."createdAt"
          GROUP BY l."source"
        `,
  ]);

  // Build per-source lookups for O(1) access in the render loop below.
  const totalMap = new Map(totalByGroup.map(r => [r.source, r._count._all]));
  const contactedMap = new Map(contactedByGroup.map(r => [r.source, r._count._all]));
  const qualifiedMap = new Map(qualifiedByGroup.map(r => [r.source, r._count._all]));
  const bookedMap = new Map(bookedByGroup.map(r => [r.source, r._count._all]));
  const lostMap = new Map(lostByGroup.map(r => [r.source, r._count._all]));
  const aiMap = new Map(aiScoreByGroup.map(r => [r.source, r._avg.aiScoreValue]));
  const firstCallMap = new Map(
    firstCallRows.map(r => [r.source, r.avg_mins === null ? null : Number(r.avg_mins)])
  );

  // Assemble rows in stable enum order so the table doesn't reshuffle
  // between renders when counts change.
  const rows: SourceRow[] = (Object.values(LeadSource) as LeadSource[]).map((src) => {
    const total = totalMap.get(src) ?? 0;
    const qualified = qualifiedMap.get(src) ?? 0;
    const booked = bookedMap.get(src) ?? 0;
    const avgAi = aiMap.get(src) ?? null;
    const firstCall = firstCallMap.get(src) ?? null;
    return {
      source: src,
      total,
      contacted: contactedMap.get(src) ?? 0,
      qualified,
      booked,
      lost: lostMap.get(src) ?? 0,
      qualifiedPct: total > 0 ? (qualified / total) * 100 : 0,
      bookedPct: total > 0 ? (booked / total) * 100 : 0,
      avgFirstCallMins: firstCall,
      avgAiScore: avgAi === null ? null : Number(avgAi),
    };
  });

  // ── Summary tiles ────────────────────────────────────────────────
  // Only consider sources with a meaningful sample size (>=3 leads) for
  // "best of" picks — otherwise one fluky booking on a 1-lead source
  // wins every tile and the insight is noise. The first-call tiles use
  // a more relaxed threshold because even a single call gives a real
  // response-time signal.
  const significant = rows.filter(r => r.total >= 3);
  const bestBooking = [...significant].sort((a, b) => b.bookedPct - a.bookedPct)[0] ?? null;
  const bestQualified = [...significant].sort((a, b) => b.qualifiedPct - a.qualifiedPct)[0] ?? null;
  const withFirstCall = rows.filter(r => r.avgFirstCallMins !== null && r.total >= 2);
  const fastestFirstCall = [...withFirstCall].sort((a, b) =>
    (a.avgFirstCallMins ?? Infinity) - (b.avgFirstCallMins ?? Infinity)
  )[0] ?? null;
  const slowestFirstCall = [...withFirstCall].sort((a, b) =>
    (b.avgFirstCallMins ?? -Infinity) - (a.avgFirstCallMins ?? -Infinity)
  )[0] ?? null;

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* Clear back affordance per Lalit feedback 2026-06 — the
              breadcrumb on its own wasn't obvious enough. */}
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">Lead Source Breakdown</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Which sources are actually closing? · {rangeLabel} · {grandTotal} leads
          </p>
        </div>
      </div>

      {/* Shared date-range picker (?from=&to=). The picker preserves any other
          query params on Apply, so retrofitting it doesn't blow away filters
          that future iterations of this page might add. */}
      <ReportDateRangePicker defaultFrom={toYmd(since)} defaultTo={toYmd(until)} />

      {/* Summary tiles — best/worst at a glance so Lalit doesn't have
          to scan the table to find the action. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">
            Best by booking %
          </div>
          {bestBooking && bestBooking.bookedPct > 0 ? (
            <>
              <div className="text-base sm:text-lg font-extrabold text-emerald-800 mt-1 leading-tight">
                {bestBooking.source.replaceAll("_", " ")}
              </div>
              <div className="text-[11px] text-emerald-700/70 mt-0.5">
                {bestBooking.bookedPct.toFixed(1)}% · {bestBooking.booked}/{bestBooking.total} booked
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Not enough data</div>
          )}
        </div>

        <div className="card p-4 border-l-4 border-sky-500">
          <div className="text-[10px] uppercase tracking-widest text-sky-700 font-bold">
            Best by qualified %
          </div>
          {bestQualified && bestQualified.qualifiedPct > 0 ? (
            <>
              <div className="text-base sm:text-lg font-extrabold text-sky-800 mt-1 leading-tight">
                {bestQualified.source.replaceAll("_", " ")}
              </div>
              <div className="text-[11px] text-sky-700/70 mt-0.5">
                {bestQualified.qualifiedPct.toFixed(1)}% · {bestQualified.qualified}/{bestQualified.total} qualified
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Not enough data</div>
          )}
        </div>

        <div className="card p-4 border-l-4 border-indigo-500">
          <div className="text-[10px] uppercase tracking-widest text-indigo-700 font-bold">
            Fastest first call
          </div>
          {fastestFirstCall ? (
            <>
              <div className="text-base sm:text-lg font-extrabold text-indigo-800 mt-1 leading-tight">
                {fastestFirstCall.source.replaceAll("_", " ")}
              </div>
              <div className="text-[11px] text-indigo-700/70 mt-0.5">
                Avg {fmtMins(fastestFirstCall.avgFirstCallMins)} to first dial
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Not enough data</div>
          )}
        </div>

        <div className="card p-4 border-l-4 border-rose-500">
          <div className="text-[10px] uppercase tracking-widest text-rose-700 font-bold">
            Slowest first call
          </div>
          {slowestFirstCall ? (
            <>
              <div className="text-base sm:text-lg font-extrabold text-rose-800 mt-1 leading-tight">
                {slowestFirstCall.source.replaceAll("_", " ")}
              </div>
              <div className="text-[11px] text-rose-700/70 mt-0.5">
                Avg {fmtMins(slowestFirstCall.avgFirstCallMins)} · response gap
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-2">Not enough data</div>
          )}
        </div>
      </div>

      {/* Main breakdown table */}
      <div className="card p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Source funnel · {rangeLabel}
        </div>
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-200">
              <th className="text-left py-2 pr-2">Source</th>
              <th className="text-right py-2 px-2">Total</th>
              <th className="text-right py-2 px-2">Contacted</th>
              <th className="text-right py-2 px-2">Qualified</th>
              <th className="text-right py-2 px-2">Booked</th>
              <th className="text-right py-2 px-2">Lost</th>
              <th className="text-right py-2 px-2">→ Qualified</th>
              <th className="text-right py-2 px-2">→ Booking</th>
              <th className="text-right py-2 px-2">First call</th>
              <th className="text-right py-2 pl-2">Avg AI score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.source} className={r.total === 0 ? "text-gray-400" : ""}>
                <td className="py-2 pr-2 font-medium">{r.source.replaceAll("_", " ")}</td>
                <td className="text-right px-2 tabular-nums">{r.total}</td>
                <td className="text-right px-2 tabular-nums">{r.contacted}</td>
                <td className="text-right px-2 tabular-nums">{r.qualified}</td>
                <td className="text-right px-2 tabular-nums font-semibold">{r.booked}</td>
                <td className="text-right px-2 tabular-nums">{r.lost}</td>
                <td className={`text-right px-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.qualifiedPct)}`}>
                  {r.total === 0 ? "—" : `${r.qualifiedPct.toFixed(1)}%`}
                </td>
                <td className={`text-right px-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.bookedPct)}`}>
                  {r.total === 0 ? "—" : `${r.bookedPct.toFixed(1)}%`}
                </td>
                <td className="text-right px-2 tabular-nums">{fmtMins(r.avgFirstCallMins)}</td>
                <td className="text-right pl-2 tabular-nums">
                  {r.avgAiScore === null ? "—" : Math.round(r.avgAiScore)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-300 font-semibold">
              <td className="py-2 pr-2">Total</td>
              <td className="text-right px-2 tabular-nums">{rows.reduce((s, r) => s + r.total, 0)}</td>
              <td className="text-right px-2 tabular-nums">{rows.reduce((s, r) => s + r.contacted, 0)}</td>
              <td className="text-right px-2 tabular-nums">{rows.reduce((s, r) => s + r.qualified, 0)}</td>
              <td className="text-right px-2 tabular-nums">{rows.reduce((s, r) => s + r.booked, 0)}</td>
              <td className="text-right px-2 tabular-nums">{rows.reduce((s, r) => s + r.lost, 0)}</td>
              <td colSpan={4}></td>
            </tr>
          </tfoot>
        </table>
        <p className="text-[10px] text-gray-500 mt-3">
          Conversion-rate cells: <span className="px-1 rounded bg-emerald-50 text-emerald-800">&gt;20%</span> green ·
          <span className="px-1 rounded bg-amber-50 text-amber-800 ml-1">&gt;10%</span> amber ·
          <span className="px-1 rounded bg-rose-50 text-rose-800 ml-1">≤10%</span> red.
          First call = average wall-clock minutes from lead creation to the first logged dial (leads with no call excluded).
        </p>
      </div>
    </>
  );
}

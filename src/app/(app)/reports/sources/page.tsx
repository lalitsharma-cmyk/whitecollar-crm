import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { sourceBreakdown, effectiveSource, sourceEnumLabel } from "@/lib/sourceLabel";
import { formatMedium } from "@/lib/mediumManager";
import { ACTIVE_PURSUIT_STATUSES, SUPPRESSED_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";
import { subDays, startOfYear, startOfMonth, startOfQuarter } from "date-fns";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";
import { leadSourceModule, type SourceModule } from "@/lib/moduleSource";
import { PENDING_CALL_OUTCOMES } from "@/lib/ghosting";
import { ModuleBreakdownTable, type ModuleBreakdownRow } from "@/components/ModuleBreakdown";

export const dynamic = "force-dynamic";

// Lead Source Breakdown — answers "which sources are working?".
// One row per effective source (verbatim sourceRaw, enum-label fallback),
// columns expose the full funnel
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
  source: string;
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

// Medium = the contact channel (Call / WhatsApp / Email + customs). Same funnel
// slice as the source table (total → contacted → qualified → booked / lost) so
// Lalit can compare "which CHANNEL converts" the same way as "which SOURCE".
interface MediumRow {
  medium: string;
  total: number;
  contacted: number;
  qualified: number;
  booked: number;
  lost: number;
  qualifiedPct: number;
  bookedPct: number;
}

// Group rows by effective medium (formatMedium resolves custom "Other" →
// mediumOther). Leads with no medium set are bucketed under "—" so the totals
// reconcile with the source table's grand total.
function mediumBreakdown(
  rows: { medium: string | null; mediumOther: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.medium ? formatMedium(r.medium, r.mediumOther) : "—";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Property Type = the asset class (Residential / Commercial / Mixed Use). Same
// funnel slice as the source/medium tables so Lalit can compare "which TYPE
// converts". Leads with no type set bucket under "—" so totals reconcile.
interface PropertyTypeRow {
  type: string;
  total: number;
  contacted: number;
  qualified: number;
  booked: number;
  lost: number;
  qualifiedPct: number;
  bookedPct: number;
}

function propertyTypeBreakdown(
  rows: { propertyType: string | null }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.propertyType && r.propertyType.trim() ? r.propertyType : "—";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// Active-pursuit statuses — status-only, no stage system.
const QUALIFIED_PLUS = ACTIVE_PURSUIT_STATUSES;
// Booked — both DB casings of the booked status (see BOOKED_STATUSES).
const BOOKED = BOOKED_STATUSES;

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
  // Five lead fetches (grouped by effective source in JS via sourceBreakdown),
  // one AI-score fetch, and one $queryRaw — every query is bounded by `since`.
  const [
    totalRows,
    contactedRows,
    qualifiedRows,
    bookedRows,
    lostRows,
    aiScoreRows,
    firstCallRows,
  ] = await Promise.all([
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true, leadOrigin: true, isColdCall: true },
    }),
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, currentStatus: { notIn: SUPPRESSED_STATUSES }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true, leadOrigin: true, isColdCall: true },
    }),
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, currentStatus: { in: QUALIFIED_PLUS }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true, leadOrigin: true, isColdCall: true },
    }),
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, currentStatus: { in: [...BOOKED] }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true, leadOrigin: true, isColdCall: true },
    }),
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, currentStatus: { in: SUPPRESSED_STATUSES }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, medium: true, mediumOther: true, propertyType: true, leadOrigin: true, isColdCall: true },
    }),
    // AI score avg per effective source — pull rows + reduce in JS (below) so the
    // average keys on the verbatim source, consistent with the count breakdowns.
    prisma.lead.findMany({
      where: { deletedAt: null, createdAt: { gte: since, lte: until }, aiScoreValue: { not: null }, ...(managerTeam ? { forwardedTeam: managerTeam } : {}) },
      select: { source: true, sourceRaw: true, aiScoreValue: true },
    }),

    // Average minutes from lead.createdAt to the FIRST CallLog for that
    // lead. DISTINCT ON picks the earliest CallLog per lead in one pass,
    // then we average the delta per source. EXTRACT(EPOCH FROM ...)/60
    // returns minutes as a number so we can pass it straight through.
    // Type guard: rows without a CallLog don't appear here, which is what
    // we want — we measure "speed when we DID respond", not "speed
    // including unresponded leads".
    //
    // PENDING GUARD (2026-07-18): DISTINCT ON ... ORDER BY startedAt ASC picks the
    // EARLIEST row per lead, so an abandoned dial that never left INITIATED would
    // BE the first call — scoring as a near-instant response and hiding the real
    // call that followed. "First call" has always meant the first call that
    // actually happened; excluding unresolved dials keeps that definition intact.
    managerTeam
      ? prisma.$queryRaw<Array<{ source: string; avg_mins: number | null }>>`
          WITH first_call AS (
            SELECT DISTINCT ON (cl."leadId")
                   cl."leadId" AS lead_id,
                   cl."startedAt" AS first_call_at
            FROM "CallLog" cl
            WHERE cl."leadId" IS NOT NULL
              AND cl."outcome"::text <> ALL(${PENDING_CALL_OUTCOMES})
            ORDER BY cl."leadId", cl."startedAt" ASC
          )
          SELECT l."source"::text AS source,
                 AVG(EXTRACT(EPOCH FROM (fc.first_call_at - l."createdAt")) / 60.0) AS avg_mins
          FROM "Lead" l
          JOIN first_call fc ON fc.lead_id = l."id"
          WHERE l."createdAt" >= ${since}
            AND l."createdAt" <= ${until}
            AND l."deletedAt" IS NULL
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
              AND cl."outcome"::text <> ALL(${PENDING_CALL_OUTCOMES})
            ORDER BY cl."leadId", cl."startedAt" ASC
          )
          SELECT l."source"::text AS source,
                 AVG(EXTRACT(EPOCH FROM (fc.first_call_at - l."createdAt")) / 60.0) AS avg_mins
          FROM "Lead" l
          JOIN first_call fc ON fc.lead_id = l."id"
          WHERE l."createdAt" >= ${since}
            AND l."createdAt" <= ${until}
            AND l."deletedAt" IS NULL
            AND fc.first_call_at >= l."createdAt"
          GROUP BY l."source"
        `,
  ]);

  // Build per-source lookups for O(1) access in the render loop below. Each
  // map is keyed by the EFFECTIVE source (verbatim sourceRaw, enum label
  // fallback) via sourceBreakdown, so the funnel rows reflect the real channel.
  const toMap = (rows: { source: string | null; sourceRaw: string | null }[]) =>
    new Map(sourceBreakdown(rows).map(b => [b.source, b.n]));
  const totalMap = toMap(totalRows);
  const contactedMap = toMap(contactedRows);
  const qualifiedMap = toMap(qualifiedRows);
  const bookedMap = toMap(bookedRows);
  const lostMap = toMap(lostRows);

  // AI score average per effective source — reduce the pulled rows in JS so the
  // average keys on the same effective source as the counts above.
  const aiAgg = new Map<string, { sum: number; n: number }>();
  for (const r of aiScoreRows) {
    if (r.aiScoreValue == null) continue;
    const key = effectiveSource(r.sourceRaw, r.source);
    const cur = aiAgg.get(key) ?? { sum: 0, n: 0 };
    cur.sum += r.aiScoreValue;
    cur.n += 1;
    aiAgg.set(key, cur);
  }
  const aiMap = new Map([...aiAgg.entries()].map(([k, v]) => [k, v.n > 0 ? v.sum / v.n : null]));

  // First-call avg comes from a raw query grouped by the enum `source`; relabel
  // its key through sourceEnumLabel so it joins the effective-source rows. (For
  // the backfilled data sourceRaw == the enum's friendly label, so these align.)
  const firstCallMap = new Map<string, number | null>();
  for (const r of firstCallRows) {
    firstCallMap.set(sourceEnumLabel(r.source), r.avg_mins === null ? null : Number(r.avg_mins));
  }

  // Assemble one row per effective source actually present in the data, sorted
  // by total desc so the biggest channels lead the table.
  const allSources = new Set<string>([
    ...totalMap.keys(), ...contactedMap.keys(), ...qualifiedMap.keys(),
    ...bookedMap.keys(), ...lostMap.keys(), ...aiMap.keys(), ...firstCallMap.keys(),
  ]);
  const rows: SourceRow[] = [...allSources].map((src) => {
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
  }).sort((a, b) => b.total - a.total);

  // ── Medium (contact-channel) breakdown ───────────────────────────
  // Built from the SAME scoped row fetches as the source table (no extra
  // queries — the five funnel fetches now also select medium/mediumOther),
  // so date/team/deletedAt scoping is identical and the totals reconcile.
  const medTotalMap     = mediumBreakdown(totalRows);
  const medContactedMap = mediumBreakdown(contactedRows);
  const medQualifiedMap = mediumBreakdown(qualifiedRows);
  const medBookedMap    = mediumBreakdown(bookedRows);
  const medLostMap      = mediumBreakdown(lostRows);
  const allMediums = new Set<string>([
    ...medTotalMap.keys(), ...medContactedMap.keys(), ...medQualifiedMap.keys(),
    ...medBookedMap.keys(), ...medLostMap.keys(),
  ]);
  const mediumRows: MediumRow[] = [...allMediums].map((m) => {
    const total = medTotalMap.get(m) ?? 0;
    const qualified = medQualifiedMap.get(m) ?? 0;
    const booked = medBookedMap.get(m) ?? 0;
    return {
      medium: m,
      total,
      contacted: medContactedMap.get(m) ?? 0,
      qualified,
      booked,
      lost: medLostMap.get(m) ?? 0,
      qualifiedPct: total > 0 ? (qualified / total) * 100 : 0,
      bookedPct: total > 0 ? (booked / total) * 100 : 0,
    };
  }).sort((a, b) => b.total - a.total);
  const mediumGrandTotal = mediumRows.reduce((s, r) => s + r.total, 0);

  // ── Property Type breakdown ──────────────────────────────────────
  // Built from the SAME scoped row fetches as the source/medium tables (the five
  // funnel fetches now also select propertyType), so date/team/deletedAt scoping
  // is identical and the totals reconcile.
  const ptTotalMap     = propertyTypeBreakdown(totalRows);
  const ptContactedMap = propertyTypeBreakdown(contactedRows);
  const ptQualifiedMap = propertyTypeBreakdown(qualifiedRows);
  const ptBookedMap    = propertyTypeBreakdown(bookedRows);
  const ptLostMap      = propertyTypeBreakdown(lostRows);
  const allPropertyTypes = new Set<string>([
    ...ptTotalMap.keys(), ...ptContactedMap.keys(), ...ptQualifiedMap.keys(),
    ...ptBookedMap.keys(), ...ptLostMap.keys(),
  ]);
  const propertyTypeRows: PropertyTypeRow[] = [...allPropertyTypes].map((t) => {
    const total = ptTotalMap.get(t) ?? 0;
    const qualified = ptQualifiedMap.get(t) ?? 0;
    const booked = ptBookedMap.get(t) ?? 0;
    return {
      type: t,
      total,
      contacted: ptContactedMap.get(t) ?? 0,
      qualified,
      booked,
      lost: ptLostMap.get(t) ?? 0,
      qualifiedPct: total > 0 ? (qualified / total) * 100 : 0,
      bookedPct: total > 0 ? (booked / total) * 100 : 0,
    };
  }).sort((a, b) => b.total - a.total);
  const propertyTypeGrandTotal = propertyTypeRows.reduce((s, r) => s + r.total, 0);

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

  // ── Module (source_module) breakdown of the funnel ───────────────────
  // The SAME scoped funnel fetches, re-bucketed by the canonical 3-way lead
  // module (leadSourceModule from leadOrigin + isColdCall). Additive: each
  // funnel stage's grand total == Leads + Master Data + Revival, because every
  // fetched lead classifies into exactly one module. Read-only — the per-source
  // table above is untouched; this is a parallel view of the same rows.
  type Triple = Record<SourceModule, number>;
  const zeroTriple = (): Triple => ({ "Leads": 0, "Master Data": 0, "Revival Engine": 0, "Dubai Buyer Data": 0, "India Buyer Data": 0 });
  const splitOf = (leadRows: Array<{ leadOrigin: string | null; isColdCall: boolean | null }>): Triple => {
    const t = zeroTriple();
    for (const r of leadRows) t[leadSourceModule(r.leadOrigin, r.isColdCall)] += 1;
    return t;
  };
  const moduleFunnelRows: ModuleBreakdownRow[] = [
    { label: "Total", counts: splitOf(totalRows), total: totalRows.length },
    { label: "Contacted", counts: splitOf(contactedRows), total: contactedRows.length },
    { label: "Qualified", counts: splitOf(qualifiedRows), total: qualifiedRows.length },
    { label: "Booked", counts: splitOf(bookedRows), total: bookedRows.length },
    { label: "Lost", counts: splitOf(lostRows), total: lostRows.length },
  ];

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
                {bestBooking.source}
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
                {bestQualified.source}
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
                {fastestFirstCall.source}
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
                {slowestFirstCall.source}
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
                <td className="py-2 pr-2 font-medium">{r.source}</td>
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

      {/* ── Module (source_module) breakdown ────────────────────────────────
          The same scoped funnel, split across the 3 lead-origin modules
          (Leads · Master Data · Revival Engine). Additive — every stage's total
          equals Leads + Master Data + Revival. Mirrors the Agent Lead
          Performance bifurcation so the module split is consistent across
          reports. */}
      <div className="card p-4">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Module funnel · {rangeLabel} · Leads · Master Data · Revival Engine
        </div>
        <ModuleBreakdownTable rows={moduleFunnelRows} showZeroRows minWidth={480} metricHeader="Funnel stage" />
        <p className="text-[10px] text-gray-500 mt-3">
          Same scoped leads as the source table above, re-bucketed by origin module. Every stage total = Leads + Master Data + Revival Engine (each lead belongs to exactly one module). Buyer Data is a separate report and is not included here.
        </p>
      </div>

      {/* ── Medium (contact-channel) breakdown ──────────────────────────────
          Same scoped data + funnel slice as the source table, grouped by the
          channel the lead came through (Call / WhatsApp / Email + customs). */}
      <div className="card p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Medium funnel · {rangeLabel} · {mediumGrandTotal} leads
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-200">
              <th className="text-left py-2 pr-2">Medium</th>
              <th className="text-right py-2 px-2">Total</th>
              <th className="text-right py-2 px-2">Contacted</th>
              <th className="text-right py-2 px-2">Qualified</th>
              <th className="text-right py-2 px-2">Booked</th>
              <th className="text-right py-2 px-2">Lost</th>
              <th className="text-right py-2 px-2">→ Qualified</th>
              <th className="text-right py-2 pl-2">→ Booking</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mediumRows.map((r) => (
              <tr key={r.medium} className={r.total === 0 ? "text-gray-400" : ""}>
                <td className="py-2 pr-2 font-medium">{r.medium}</td>
                <td className="text-right px-2 tabular-nums">{r.total}</td>
                <td className="text-right px-2 tabular-nums">{r.contacted}</td>
                <td className="text-right px-2 tabular-nums">{r.qualified}</td>
                <td className="text-right px-2 tabular-nums font-semibold">{r.booked}</td>
                <td className="text-right px-2 tabular-nums">{r.lost}</td>
                <td className={`text-right px-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.qualifiedPct)}`}>
                  {r.total === 0 ? "—" : `${r.qualifiedPct.toFixed(1)}%`}
                </td>
                <td className={`text-right pl-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.bookedPct)}`}>
                  {r.total === 0 ? "—" : `${r.bookedPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
            {mediumRows.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-gray-400 text-xs">No leads in this window.</td></tr>
            )}
          </tbody>
          {mediumRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td className="py-2 pr-2">Total</td>
                <td className="text-right px-2 tabular-nums">{mediumRows.reduce((s, r) => s + r.total, 0)}</td>
                <td className="text-right px-2 tabular-nums">{mediumRows.reduce((s, r) => s + r.contacted, 0)}</td>
                <td className="text-right px-2 tabular-nums">{mediumRows.reduce((s, r) => s + r.qualified, 0)}</td>
                <td className="text-right px-2 tabular-nums">{mediumRows.reduce((s, r) => s + r.booked, 0)}</td>
                <td className="text-right px-2 tabular-nums">{mediumRows.reduce((s, r) => s + r.lost, 0)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="text-[10px] text-gray-500 mt-3">
          Medium = the channel the lead arrived / is worked through (Call · WhatsApp · Email · custom). Leads with no medium set are grouped under &ldquo;—&rdquo;. Same date / team scope as the source table above.
        </p>
      </div>

      {/* ── Property Type breakdown ─────────────────────────────────────────
          Same scoped data + funnel slice as the source/medium tables, grouped by
          the asset class (Residential / Commercial / Mixed Use). */}
      <div className="card p-4 overflow-x-auto">
        <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-3">
          Property type funnel · {rangeLabel} · {propertyTypeGrandTotal} leads
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-200">
              <th className="text-left py-2 pr-2">Property Type</th>
              <th className="text-right py-2 px-2">Total</th>
              <th className="text-right py-2 px-2">Contacted</th>
              <th className="text-right py-2 px-2">Qualified</th>
              <th className="text-right py-2 px-2">Booked</th>
              <th className="text-right py-2 px-2">Lost</th>
              <th className="text-right py-2 px-2">→ Qualified</th>
              <th className="text-right py-2 pl-2">→ Booking</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {propertyTypeRows.map((r) => (
              <tr key={r.type} className={r.total === 0 ? "text-gray-400" : ""}>
                <td className="py-2 pr-2 font-medium">{r.type}</td>
                <td className="text-right px-2 tabular-nums">{r.total}</td>
                <td className="text-right px-2 tabular-nums">{r.contacted}</td>
                <td className="text-right px-2 tabular-nums">{r.qualified}</td>
                <td className="text-right px-2 tabular-nums font-semibold">{r.booked}</td>
                <td className="text-right px-2 tabular-nums">{r.lost}</td>
                <td className={`text-right px-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.qualifiedPct)}`}>
                  {r.total === 0 ? "—" : `${r.qualifiedPct.toFixed(1)}%`}
                </td>
                <td className={`text-right pl-2 tabular-nums rounded ${r.total === 0 ? "text-gray-300" : pctClass(r.bookedPct)}`}>
                  {r.total === 0 ? "—" : `${r.bookedPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
            {propertyTypeRows.length === 0 && (
              <tr><td colSpan={8} className="py-4 text-center text-gray-400 text-xs">No leads in this window.</td></tr>
            )}
          </tbody>
          {propertyTypeRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-semibold">
                <td className="py-2 pr-2">Total</td>
                <td className="text-right px-2 tabular-nums">{propertyTypeRows.reduce((s, r) => s + r.total, 0)}</td>
                <td className="text-right px-2 tabular-nums">{propertyTypeRows.reduce((s, r) => s + r.contacted, 0)}</td>
                <td className="text-right px-2 tabular-nums">{propertyTypeRows.reduce((s, r) => s + r.qualified, 0)}</td>
                <td className="text-right px-2 tabular-nums">{propertyTypeRows.reduce((s, r) => s + r.booked, 0)}</td>
                <td className="text-right px-2 tabular-nums">{propertyTypeRows.reduce((s, r) => s + r.lost, 0)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
        <p className="text-[10px] text-gray-500 mt-3">
          Property Type = the asset class set on the lead (Residential · Commercial · Mixed Use). Leads with no type set are grouped under &ldquo;—&rdquo;. Same date / team scope as the source table above.
        </p>
      </div>
    </>
  );
}

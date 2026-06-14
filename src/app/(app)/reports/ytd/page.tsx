import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { CallOutcome, Prisma } from "@prisma/client";
import { BOOKED_STATUSES } from "@/lib/lead-statuses";
import { fmtMoneyDual } from "@/lib/money";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────
// Year-to-Date report — one place to answer "where is the year tracking?".
//
// Defaults: Jan 1 of current year → today (server clock).
// Override: ?from=YYYY-MM-DD&to=YYYY-MM-DD via the shared
// ReportDateRangePicker. We still call this page "YTD" because the
// default is YTD; the picker just lets Lalit re-scope to a custom window.
//
// Team split: Dubai vs India side-by-side via `Lead.forwardedTeam`. This
// matches /reports/team-comparison's scoping rule. Currency totals are
// tracked separately for AED + INR (never summed).
//
// Role-gated: ADMIN + MANAGER (no agents). Mirrors /reports/team-comparison
// and /reports/commission's policy.
// ─────────────────────────────────────────────────────────────────────────

// Currency-pair helper — used everywhere we accumulate money. AED + INR
// stay strictly separate.
type Pair = { aed: number; inr: number };
const zeroPair = (): Pair => ({ aed: 0, inr: 0 });

// Commission statuses that count toward "booked" (signed → cash-tracked).
const BOOKED_COMMISSION = ["INVOICED", "RECEIVED"] as const;
// Calls that we count as "connected" for connect-rate purposes — match the
// dashboard's definition: CONNECTED + INTERESTED both reflect a live convo.
const CONNECTED_OUTCOMES: CallOutcome[] = [CallOutcome.CONNECTED, CallOutcome.INTERESTED];

// Date parsing — accept ?from / ?to in YYYY-MM-DD. Fall back to Jan 1.
function parseYmd(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  // Strict YYYY-MM-DD; reject anything else so we don't accept "drop table".
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return fallback;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return fallback;
  return d;
}
function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(23, 59, 59, 999);
  return out;
}
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Per-team aggregator ──────────────────────────────────────────────
// We run all the team-scoped queries in parallel. forwardedTeam is the
// canonical team marker — same convention used by /reports/team-comparison.
async function computeTeamYtd(team: "Dubai" | "India", since: Date, until: Date) {
  const leadWhere: Prisma.LeadWhereInput = { forwardedTeam: team };
  const callWhere: Prisma.CallLogWhereInput = { lead: { forwardedTeam: team, deletedAt: null } };

  const [
    leadsCreated,
    bookings,
    wonDeals,
    commissionBooked,
    commissionReceived,
    callsConnected,
    callsTotal,
    topSources,
    topAgents,
  ] = await Promise.all([
    // 1. Leads created in window
    prisma.lead.count({
      where: { ...leadWhere, deletedAt: null, createdAt: { gte: since, lte: until } },
    }),
    // 2. Bookings — leads with bookingDoneAt in window. We don't gate on
    //    status because bookingDoneAt is the explicit "booking happened"
    //    timestamp (set by the EOI workflow); a lead that later moved to
    //    WON or back to NEGOTIATION still counts as a booking that period.
    prisma.lead.count({
      where: { ...leadWhere, deletedAt: null, bookingDoneAt: { gte: since, lte: until } },
    }),
    // 3. Won deals — status WON with updatedAt in window. updatedAt is
    //    used as a proxy for "moved to WON" since we don't store a
    //    dedicated wonAt timestamp.
    prisma.lead.count({
      where: { ...leadWhere, deletedAt: null, currentStatus: { in: BOOKED_STATUSES }, updatedAt: { gte: since, lte: until } },
    }),
    // 4. Commission booked — INVOICED + RECEIVED, period-keyed on
    //    bookingDoneAt (falling back to commissionReceivedAt / updatedAt
    //    same as /reports/commission). We pull rows + sum in code so we
    //    can split by currency without summing AED+INR.
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        deletedAt: null,
        commissionStatus: { in: [...BOOKED_COMMISSION] },
        OR: [
          { bookingDoneAt: { gte: since, lte: until } },
          { commissionReceivedAt: { gte: since, lte: until } },
          {
            AND: [
              { bookingDoneAt: null },
              { commissionReceivedAt: null },
              { updatedAt: { gte: since, lte: until } },
            ],
          },
        ],
      },
      select: { commissionAmount: true, commissionCurrency: true },
    }),
    // 5. Commission received — RECEIVED only, period-keyed on
    //    commissionReceivedAt (the precise marker for money in bank).
    prisma.lead.findMany({
      where: {
        ...leadWhere,
        deletedAt: null,
        commissionStatus: "RECEIVED",
        commissionReceivedAt: { gte: since, lte: until },
      },
      select: { commissionAmount: true, commissionCurrency: true },
    }),
    // 6. Calls connected (numerator)
    prisma.callLog.count({
      where: { ...callWhere, startedAt: { gte: since, lte: until }, outcome: { in: CONNECTED_OUTCOMES } },
    }),
    // 7. Calls total (denominator for connect rate)
    prisma.callLog.count({
      where: { ...callWhere, startedAt: { gte: since, lte: until } },
    }),
    // 8. Top 5 sources (by lead count in-window)
    prisma.lead.groupBy({
      by: ["source"],
      where: { ...leadWhere, deletedAt: null, createdAt: { gte: since, lte: until } },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    // 9. Top 5 agents (by WON lead count in-window, scoped to this team)
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        ...leadWhere,
        deletedAt: null,
        currentStatus: { in: BOOKED_STATUSES },
        updatedAt: { gte: since, lte: until },
        ownerId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
  ]);

  // Roll up commission rows into currency-split Pair totals.
  const booked = zeroPair();
  for (const r of commissionBooked) {
    if (!r.commissionAmount) continue;
    const cur = (r.commissionCurrency ?? "AED").toUpperCase();
    if (cur === "INR") booked.inr += r.commissionAmount;
    else booked.aed += r.commissionAmount;
  }
  const received = zeroPair();
  for (const r of commissionReceived) {
    if (!r.commissionAmount) continue;
    const cur = (r.commissionCurrency ?? "AED").toUpperCase();
    if (cur === "INR") received.inr += r.commissionAmount;
    else received.aed += r.commissionAmount;
  }

  // Resolve agent names for the leaderboard.
  const ownerIds = topAgents.map((a) => a.ownerId).filter((x): x is string => !!x);
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
    : [];
  const ownerNameById = new Map(owners.map((o) => [o.id, o.name]));

  const connectRate = callsTotal > 0 ? callsConnected / callsTotal : 0;

  return {
    team,
    leadsCreated,
    bookings,
    wonDeals,
    commissionBooked: booked,
    commissionReceived: received,
    callsConnected,
    callsTotal,
    connectRate,
    topSources: topSources.map((s) => ({ source: s.source, count: s._count._all })),
    topAgents: topAgents.map((a) => ({
      ownerId: a.ownerId,
      name: a.ownerId ? ownerNameById.get(a.ownerId) ?? "Unknown" : "Unassigned",
      count: a._count._all,
    })),
  };
}

type TeamYtd = Awaited<ReturnType<typeof computeTeamYtd>>;

export default async function YtdReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;

  // Default window — Jan 1 (UTC) of current year through end-of-today.
  const now = new Date();
  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const since = parseYmd(sp.from, jan1);
  const until = endOfDay(parseYmd(sp.to, now));

  // MANAGER sees only their own team; ADMIN sees both.
  const teamsToShow: Array<"Dubai" | "India"> =
    managerTeam === "Dubai" ? ["Dubai"]
    : managerTeam === "India" ? ["India"]
    : ["Dubai", "India"];

  const teamResults = await Promise.all(teamsToShow.map((t) => computeTeamYtd(t, since, until)));
  const dubai = teamsToShow.includes("Dubai") ? teamResults[teamsToShow.indexOf("Dubai")] : null;
  const india = teamsToShow.includes("India") ? teamResults[teamsToShow.indexOf("India")] : null;

  const isFullYtd = toYmd(since) === toYmd(jan1) && toYmd(until).slice(0, 10) === toYmd(now);

  return (
    <>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <Link href="/reports" className="text-xs text-gray-500 hover:underline">
            ← Back to reports
          </Link>
          <h1 className="text-xl sm:text-2xl font-bold">📅 Year-to-Date</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {isFullYtd
              ? `Jan 1, ${now.getUTCFullYear()} → today · ${managerTeam ? managerTeam : "Dubai vs India side-by-side"}`
              : `Custom window: ${toYmd(since)} → ${toYmd(until)}`}
          </p>
        </div>
      </div>

      <ReportDateRangePicker defaultFrom={toYmd(since)} defaultTo={toYmd(until).slice(0, 10)} />

      {/* Team columns — Dubai (AED) and India (INR) side-by-side (ADMIN).
          MANAGER sees only their own team's column. */}
      <div className={`grid grid-cols-1 ${!managerTeam ? "lg:grid-cols-2" : ""} gap-4`}>
        {dubai && <TeamColumn t={dubai} accent="border-amber-500" flag="🇦🇪" subTitle="AED" />}
        {india && <TeamColumn t={india} accent="border-emerald-500" flag="🇮🇳" subTitle="INR" />}
      </div>

      <div className="text-[10px] text-gray-500 leading-relaxed">
        Notes — Team membership uses <code className="bg-gray-100 px-1 rounded">Lead.forwardedTeam</code>.
        Currency totals are tracked separately for AED + INR and never summed. Bookings count leads
        with <code className="bg-gray-100 px-1 rounded">bookingDoneAt</code> in window. Won deals
        count <code className="bg-gray-100 px-1 rounded">status = WON</code> with{" "}
        <code className="bg-gray-100 px-1 rounded">updatedAt</code> in window. Commission booked =
        INVOICED + RECEIVED; received = RECEIVED only. Connect rate = (CONNECTED + INTERESTED) /
        total calls.
      </div>
    </>
  );
}

// ─── Team column ──────────────────────────────────────────────────────
// Renders one team's full YTD card — all 9 metrics. Lives inline so it
// shares the parent's helpers; not worth a separate file for one caller.
function TeamColumn({
  t,
  accent,
  flag,
  subTitle,
}: {
  t: TeamYtd;
  accent: string;
  flag: string;
  subTitle: string;
}) {
  return (
    <section className={`card p-4 sm:p-5 border-l-4 ${accent}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
          <span>{flag}</span>
          <span>{t.team}</span>
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
          {subTitle}
        </span>
      </div>

      {/* Numeric stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
        <Stat label="Leads created" value={t.leadsCreated.toLocaleString()} />
        <Stat label="Bookings" value={t.bookings.toLocaleString()} />
        <Stat label="Won deals" value={t.wonDeals.toLocaleString()} />
        <Stat
          label="Calls connected"
          value={t.callsConnected.toLocaleString()}
          sub={`/ ${t.callsTotal.toLocaleString()}`}
        />
        <Stat label="Connect rate" value={`${Math.round(t.connectRate * 100)}%`} />
        <Stat
          label="Commission booked"
          value={
            t.commissionBooked.aed + t.commissionBooked.inr > 0
              ? fmtMoneyDual(t.commissionBooked)
              : "—"
          }
        />
      </div>

      {/* Commission received separately — different financial concept */}
      <div className="mt-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
        <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-semibold">
          💰 Commission received
        </div>
        <div className="text-lg font-extrabold text-emerald-900 mt-0.5 leading-tight">
          {t.commissionReceived.aed + t.commissionReceived.inr > 0
            ? fmtMoneyDual(t.commissionReceived)
            : "—"}
        </div>
        <div className="text-[10px] text-emerald-700/70 mt-0.5">
          Money actually in the bank · status = RECEIVED
        </div>
      </div>

      {/* Top 5 sources */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
          🎯 Top 5 sources
        </div>
        {t.topSources.length === 0 ? (
          <div className="text-xs text-gray-400 italic">No leads in window</div>
        ) : (
          <ol className="space-y-1">
            {t.topSources.map((s, i) => (
              <li
                key={s.source}
                className="flex items-center justify-between text-sm border-b last:border-b-0 border-gray-100 py-1"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 tabular-nums w-4">{i + 1}.</span>
                  <span className="font-medium">{s.source.replaceAll("_", " ")}</span>
                </span>
                <span className="font-semibold tabular-nums">{s.count}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Top 5 agents (WON) */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
          🏆 Top 5 agents (WON deals)
        </div>
        {t.topAgents.length === 0 ? (
          <div className="text-xs text-gray-400 italic">No WON deals in window</div>
        ) : (
          <ol className="space-y-1">
            {t.topAgents.map((a, i) => (
              <li
                key={a.ownerId ?? "__unassigned"}
                className="flex items-center justify-between text-sm border-b last:border-b-0 border-gray-100 py-1"
              >
                <span className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 tabular-nums w-4">{i + 1}.</span>
                  <span className="font-medium">{a.name}</span>
                </span>
                <span className="font-semibold tabular-nums">{a.count}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-lg sm:text-xl font-extrabold text-[#0b1a33] leading-tight">
        {value}
        {sub && <span className="text-xs text-gray-500 font-semibold ml-1">{sub}</span>}
      </div>
      <div className="text-[10px] tracking-widest text-gray-500 uppercase mt-0.5">{label}</div>
    </div>
  );
}

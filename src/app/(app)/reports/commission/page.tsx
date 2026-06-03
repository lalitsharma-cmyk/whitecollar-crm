import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { LeadStatus, Prisma } from "@prisma/client";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import Link from "next/link";
import ReportDateRangePicker from "@/components/ReportDateRangePicker";

export const dynamic = "force-dynamic";

// §13 Phase 6 — Commission / earnings report.
//
// Why: once a Lead crosses into BOOKING_DONE/WON, the deal carries a
// commission (Lead.commissionAmount, in smallest currency unit). Lalit wants
// one place that answers "how much have we earned this period, how much has
// actually landed, and which agent drove it" — split correctly by currency
// (Dubai books AED, India books INR) so nothing is ever summed across the two.
//
// Period is keyed off bookingDoneAt (when the deal closed), falling back to
// commissionReceivedAt, then updatedAt — so a booking always lands in some
// bucket even if the precise close timestamp wasn't recorded.
//
// Currency rule: every amount is a smallest-currency-unit integer. We display
// in major units (divide by 100) and NEVER add AED + INR — totals track two
// independent running sums and render via fmtMoneyDual.

// Date controls migrated to the shared ReportDateRangePicker (?from=&to=).
// "All time" is now expressed as "no from/to supplied" — the cleanest mapping
// given the picker has no built-in all-time chip. ?range= is still parsed
// for one release so old bookmarks resolve to a sensible window.
type LegacyRangeKey = "month" | "quarter" | "year" | "all";
function parseLegacyRange(raw: string | undefined): LegacyRangeKey {
  if (raw === "quarter" || raw === "year" || raw === "all") return raw;
  return "month";
}
// Legacy enum → start date (null = all time). Used only for backwards-compat
// when the new ?from=&to= aren't supplied.
function legacyRangeStart(key: LegacyRangeKey): Date | null {
  const now = new Date();
  if (key === "all") return null;
  if (key === "year") return new Date(now.getFullYear(), 0, 1);
  if (key === "quarter") {
    const q = Math.floor(now.getMonth() / 3); // 0..3
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1); // month
}

// Strict YYYY-MM-DD → UTC midnight. Reject junk so we don't slip an
// Invalid Date into a Prisma filter.
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

// commissionAmount is stored as the raw whole-currency number the agent types
// in the EOI workflow card (e.g. 50000 = AED 50,000) — NOT a smallest-unit
// int, despite the schema comment. The only writer is EOIWorkflowCard, which
// does Number(form.commissionAmount) with no ×100 and renders it back
// un-divided. So we pass it straight through. (If a future migration switches
// to fils/paise, change this one function.)
function major(amount: number): number {
  return amount;
}

// Currency normalised to "AED" | "INR" (default AED — matches money.ts).
function cur(c: string | null | undefined): "AED" | "INR" {
  return (c ?? "").toUpperCase() === "INR" ? "INR" : "AED";
}

const BOOKINGS: LeadStatus[] = [LeadStatus.BOOKING_DONE, LeadStatus.WON];

const STATUS_META: Record<
  string,
  { label: string; badge: string; card: string; accent: string }
> = {
  PENDING: {
    label: "Pending",
    badge: "bg-amber-100 text-amber-800 border border-amber-200",
    card: "border-amber-200 bg-amber-50",
    accent: "text-amber-900",
  },
  INVOICED: {
    label: "Invoiced",
    badge: "bg-sky-100 text-sky-800 border border-sky-200",
    card: "border-sky-200 bg-sky-50",
    accent: "text-sky-900",
  },
  RECEIVED: {
    label: "Received",
    badge: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    card: "border-emerald-200 bg-emerald-50",
    accent: "text-emerald-900",
  },
};
function statusKey(s: string | null | undefined): "PENDING" | "INVOICED" | "RECEIVED" {
  const u = (s ?? "").toUpperCase();
  if (u === "RECEIVED" || u === "INVOICED") return u;
  return "PENDING";
}

// A running pair of currency sums — used everywhere we accumulate money so we
// never add AED + INR. Stored in MAJOR units already.
type Pair = { aed: number; inr: number };
const zero = (): Pair => ({ aed: 0, inr: 0 });
function add(p: Pair, currency: string | null | undefined, majorAmount: number): void {
  if (cur(currency) === "INR") p.inr += majorAmount;
  else p.aed += majorAmount;
}

export default async function CommissionReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;

  // Resolve the window. Precedence:
  //   1. ?from=&to= (new shared-picker contract) ─ wins if present
  //   2. ?range= (legacy enum — month/quarter/year/all) for one release
  //   3. default = This month (matches previous page default)
  //
  // "All time" maps to "no from/to" — there's no all-time chip on the shared
  // picker, but the absence of both params is the cleanest signal and means
  // we don't have to fabricate a synthetic origin date.
  const fromParam = parseYmd(sp.from);
  const toParam = parseYmd(sp.to);

  let since: Date | null;
  let until: Date | null;
  let rangeLabel: string;
  // Were date params explicitly supplied in the URL? Used to disambiguate
  // "user picked a window" from "user hit the page with nothing".
  const hasDateParams = sp.from !== undefined || sp.to !== undefined;

  if (fromParam && toParam) {
    since = fromParam;
    until = endOfDayUtc(toParam);
    rangeLabel = `${toYmd(since)} → ${toYmd(until)}`;
  } else if (hasDateParams) {
    // Partial picker submission — fall back to wide-open on the missing side.
    since = fromParam ?? null;
    until = toParam ? endOfDayUtc(toParam) : null;
    rangeLabel = since
      ? until
        ? `${toYmd(since)} → ${toYmd(until)}`
        : `From ${toYmd(since)}`
      : until
      ? `Up to ${toYmd(until)}`
      : "All time";
  } else if (sp.range !== undefined) {
    // Legacy ?range= path.
    const legacy = parseLegacyRange(sp.range);
    since = legacyRangeStart(legacy);
    until = endOfDayUtc(new Date());
    rangeLabel =
      legacy === "all"
        ? "All time"
        : legacy === "month"
        ? "This month"
        : legacy === "quarter"
        ? "This quarter"
        : "This year";
  } else {
    // Default — this month, matching the prior default.
    since = legacyRangeStart("month");
    until = endOfDayUtc(new Date());
    rangeLabel = "This month";
  }

  // Period filter on bookingDoneAt, falling back to commissionReceivedAt then
  // updatedAt — OR'd so a booking with any one of those in-window is counted.
  // gte+lte both bounded by the picker; if either bound is null we just omit it.
  // Inline shape rather than `Prisma.DateTimeFilter` — Prisma's generic version
  // varies by client version, this stays portable.
  const dateBound = (d1: Date | null, d2: Date | null): { gte?: Date; lte?: Date } | undefined => {
    if (!d1 && !d2) return undefined;
    const out: { gte?: Date; lte?: Date } = {};
    if (d1) out.gte = d1;
    if (d2) out.lte = d2;
    return out;
  };
  const periodWhere: Prisma.LeadWhereInput | undefined =
    since == null && until == null
      ? undefined
      : {
          OR: [
            { bookingDoneAt: dateBound(since, until) },
            { commissionReceivedAt: dateBound(since, until) },
            // updatedAt fallback only when no explicit booking/received stamp.
            {
              AND: [
                { bookingDoneAt: null },
                { commissionReceivedAt: null },
                { updatedAt: dateBound(since, until) },
              ],
            },
          ],
        };

  // "Counts as a booking" — commission entered OR status is WON/BOOKING_DONE.
  const bookingWhere: Prisma.LeadWhereInput = {
    AND: [
      { OR: [{ commissionAmount: { gt: 0 } }, { status: { in: BOOKINGS } }] },
      ...(periodWhere ? [periodWhere] : []),
      ...(managerTeam ? [{ forwardedTeam: managerTeam }] : []),
    ],
  };

  // Two queries in parallel: the booking rows we report on, and the owning
  // users (so agents with bookings always resolve to a real name).
  const [leads, owners] = await Promise.all([
    prisma.lead.findMany({
      where: bookingWhere,
      select: {
        id: true,
        name: true,
        ownerId: true,
        status: true,
        commissionAmount: true,
        commissionCurrency: true,
        commissionStatus: true,
        commissionReceivedAt: true,
        bookingDoneAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.user.findMany({ where: { ...(managerTeam ? { team: managerTeam } : {}) }, select: { id: true, name: true } }),
  ]);

  const ownerName = new Map(owners.map((o) => [o.id, o.name]));

  // ── Top-line aggregates (all in MAJOR units, currency-split) ──
  const booked = zero(); // total commission value of all bookings in range
  const received = zero(); // status RECEIVED
  const outstanding = zero(); // status PENDING or INVOICED
  const bookingsCount = leads.length;

  // Status breakdown: count + money per status bucket.
  const byStatus: Record<string, { count: number; money: Pair }> = {
    PENDING: { count: 0, money: zero() },
    INVOICED: { count: 0, money: zero() },
    RECEIVED: { count: 0, money: zero() },
  };

  // Per-agent rollup.
  type AgentRow = {
    ownerId: string | null;
    name: string;
    bookings: number;
    total: Pair;
    received: Pair;
    outstanding: Pair;
  };
  const agents = new Map<string, AgentRow>();

  for (const l of leads) {
    const amt = l.commissionAmount && l.commissionAmount > 0 ? major(l.commissionAmount) : 0;
    const sk = statusKey(l.commissionStatus);

    add(booked, l.commissionCurrency, amt);
    if (sk === "RECEIVED") add(received, l.commissionCurrency, amt);
    else add(outstanding, l.commissionCurrency, amt); // PENDING + INVOICED

    byStatus[sk].count += 1;
    add(byStatus[sk].money, l.commissionCurrency, amt);

    // Per-agent — key on ownerId, "__unassigned" for null.
    const key = l.ownerId ?? "__unassigned";
    let row = agents.get(key);
    if (!row) {
      row = {
        ownerId: l.ownerId,
        name: l.ownerId ? ownerName.get(l.ownerId) ?? "Unknown" : "Unassigned",
        bookings: 0,
        total: zero(),
        received: zero(),
        outstanding: zero(),
      };
      agents.set(key, row);
    }
    row.bookings += 1;
    add(row.total, l.commissionCurrency, amt);
    if (sk === "RECEIVED") add(row.received, l.commissionCurrency, amt);
    else add(row.outstanding, l.commissionCurrency, amt);
  }

  // Sort agents by total commission desc — combine both currencies for the
  // sort key only (ordering, never display). AED + INR magnitudes aren't
  // comparable, so we rank by AED then INR to give a stable, sensible order.
  const agentRows = [...agents.values()].sort((a, b) => {
    if (b.total.aed !== a.total.aed) return b.total.aed - a.total.aed;
    return b.total.inr - a.total.inr;
  });

  // Per-booking detail — most recent 50 by booking date (fallback chain).
  const detailDate = (l: (typeof leads)[number]): number =>
    (l.bookingDoneAt ?? l.commissionReceivedAt ?? l.updatedAt).getTime();
  const detailRows = [...leads].sort((a, b) => detailDate(b) - detailDate(a)).slice(0, 50);

  const fmtDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : "—";

  const hasBookings = bookingsCount > 0;

  return (
    <>
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Commission &amp; Earnings</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Booked deals · currency-correct (AED + INR never summed) · {rangeLabel}
          </p>
        </div>
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
      </div>

      {/* Shared date-range picker — replaces the legacy ?range= chip row.
          "All time" is expressed by clearing both inputs (i.e. visiting with
          no from/to). The default values come from the resolved window so
          the picker reflects whichever path got us here. */}
      <ReportDateRangePicker
        defaultFrom={since ? toYmd(since) : ""}
        defaultTo={until ? toYmd(until) : ""}
      />

      {!hasBookings ? (
        <div className="card p-8 text-center">
          <div className="text-3xl">💸</div>
          <div className="font-semibold mt-2">No bookings in this period</div>
          <div className="text-sm text-gray-500 mt-1">
            No leads with commission or a WON/BOOKING_DONE status fall in{" "}
            {rangeLabel.toLowerCase()}. Try a wider period.
          </div>
        </div>
      ) : (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="card p-4 border-l-4 border-emerald-500">
              <div className="text-[10px] uppercase tracking-widest text-emerald-700 font-bold">
                Commission booked
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-emerald-800 mt-1 leading-tight">
                {fmtMoneyDual(booked)}
              </div>
              <div className="text-[11px] text-emerald-700/70 mt-1">Across all bookings in range</div>
            </div>
            <div className="card p-4 border-l-4 border-teal-500">
              <div className="text-[10px] uppercase tracking-widest text-teal-700 font-bold">
                Received
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-teal-800 mt-1 leading-tight">
                {fmtMoneyDual(received)}
              </div>
              <div className="text-[11px] text-teal-700/70 mt-1">Money actually in the bank</div>
            </div>
            <div className="card p-4 border-l-4 border-amber-500">
              <div className="text-[10px] uppercase tracking-widest text-amber-700 font-bold">
                Outstanding
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-amber-800 mt-1 leading-tight">
                {fmtMoneyDual(outstanding)}
              </div>
              <div className="text-[11px] text-amber-700/70 mt-1">Pending + invoiced — chase these</div>
            </div>
            <div className="card p-4 border-l-4 border-[#0b1a33]">
              <div className="text-[10px] uppercase tracking-widest text-gray-600 font-bold">
                Bookings
              </div>
              <div className="text-lg sm:text-xl font-extrabold text-[#0b1a33] mt-1 leading-tight">
                {bookingsCount.toLocaleString()}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">Deals counted in this period</div>
            </div>
          </div>

          {/* Status breakdown */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {(["PENDING", "INVOICED", "RECEIVED"] as const).map((s) => {
              const meta = STATUS_META[s];
              const x = byStatus[s];
              return (
                <div key={s} className={`card p-4 border ${meta.card}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <span className={`text-lg font-bold ${meta.accent}`}>{x.count}</span>
                  </div>
                  <div className={`text-base font-extrabold mt-2 leading-tight ${meta.accent}`}>
                    {fmtMoneyDual(x.money)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per-agent table */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-semibold">
              Commission by agent
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="text-left px-4 py-2 font-semibold">Agent</th>
                    <th className="text-center px-3 py-2 font-semibold">Bookings</th>
                    <th className="text-right px-3 py-2 font-semibold">Total commission</th>
                    <th className="text-right px-3 py-2 font-semibold">Received</th>
                    <th className="text-right px-4 py-2 font-semibold">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {agentRows.map((a) => (
                    <tr key={a.ownerId ?? "__unassigned"} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium">{a.name}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{a.bookings}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {fmtMoneyDual(a.total)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                        {fmtMoneyDual(a.received)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-700">
                        {fmtMoneyDual(a.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-booking detail (last 50) */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500 font-semibold flex items-center justify-between">
              <span>Bookings detail</span>
              <span className="font-normal text-gray-400 normal-case tracking-normal">
                {detailRows.length === 50 ? "Latest 50" : `${detailRows.length} total`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="text-left px-4 py-2 font-semibold">Lead</th>
                    <th className="text-left px-3 py-2 font-semibold">Owner</th>
                    <th className="text-left px-3 py-2 font-semibold">Booking date</th>
                    <th className="text-right px-3 py-2 font-semibold">Commission</th>
                    <th className="text-center px-4 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detailRows.map((l) => {
                    const sk = statusKey(l.commissionStatus);
                    const meta = STATUS_META[sk];
                    const amt = l.commissionAmount && l.commissionAmount > 0 ? major(l.commissionAmount) : 0;
                    return (
                      <tr key={l.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/leads/${l.id}`}
                            className="font-medium text-[#0b1a33] hover:underline"
                          >
                            {l.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {l.ownerId ? ownerName.get(l.ownerId) ?? "Unknown" : "Unassigned"}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 tabular-nums">
                          {fmtDate(l.bookingDoneAt ?? l.commissionReceivedAt ?? l.updatedAt)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                          {amt > 0 ? fmtMoney(amt, cur(l.commissionCurrency)) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${meta.badge}`}
                          >
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-[10px] text-gray-500 leading-relaxed">
            Notes — Amounts are stored in the smallest currency unit and shown in major units. AED
            and INR are tracked as separate running totals and never summed. A lead is counted when
            it has a commission amount &gt; 0 <em>or</em> its status is WON / BOOKING_DONE. Period is
            keyed off the booking date (<code className="bg-gray-100 px-1 rounded">bookingDoneAt</code>),
            falling back to <code className="bg-gray-100 px-1 rounded">commissionReceivedAt</code> then{" "}
            <code className="bg-gray-100 px-1 rounded">updatedAt</code>. Outstanding = Pending +
            Invoiced.
          </div>
        </>
      )}
    </>
  );
}

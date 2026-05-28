import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { LeadStatus, Prisma } from "@prisma/client";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";
import Link from "next/link";

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

type RangeKey = "month" | "quarter" | "year" | "all";
const RANGE_LABEL: Record<RangeKey, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all: "All time",
};
function parseRange(raw: string | undefined): RangeKey {
  if (raw === "quarter" || raw === "year" || raw === "all") return raw;
  return "month";
}
// Returns the inclusive start of the selected window, or null for "all".
function rangeStart(key: RangeKey): Date | null {
  const now = new Date();
  if (key === "all") return null;
  if (key === "year") return new Date(now.getFullYear(), 0, 1);
  if (key === "quarter") {
    const q = Math.floor(now.getMonth() / 3); // 0..3
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1); // month
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
  await requireRole("ADMIN", "MANAGER");
  const sp = await searchParams;
  const rangeKey = parseRange(sp.range);
  const since = rangeStart(rangeKey);

  // Period filter on bookingDoneAt, falling back to commissionReceivedAt then
  // updatedAt — OR'd so a booking with any one of those in-window is counted.
  const periodWhere: Prisma.LeadWhereInput | undefined =
    since == null
      ? undefined
      : {
          OR: [
            { bookingDoneAt: { gte: since } },
            { commissionReceivedAt: { gte: since } },
            // updatedAt fallback only when no explicit booking/received stamp.
            { AND: [{ bookingDoneAt: null }, { commissionReceivedAt: null }, { updatedAt: { gte: since } }] },
          ],
        };

  // "Counts as a booking" — commission entered OR status is WON/BOOKING_DONE.
  const bookingWhere: Prisma.LeadWhereInput = {
    AND: [
      { OR: [{ commissionAmount: { gt: 0 } }, { status: { in: BOOKINGS } }] },
      ...(periodWhere ? [periodWhere] : []),
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
    prisma.user.findMany({ select: { id: true, name: true } }),
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
            Booked deals · currency-correct (AED + INR never summed) · {RANGE_LABEL[rangeKey]}
          </p>
        </div>
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
      </div>

      {/* Period selector — plain anchor links so the page stays a pure RSC. */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-gray-500">Period:</span>
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => {
          const active = k === rangeKey;
          return (
            <Link
              key={k}
              href={`/reports/commission?range=${k}`}
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

      {!hasBookings ? (
        <div className="card p-8 text-center">
          <div className="text-3xl">💸</div>
          <div className="font-semibold mt-2">No bookings in this period</div>
          <div className="text-sm text-gray-500 mt-1">
            No leads with commission or a WON/BOOKING_DONE status fall in{" "}
            {RANGE_LABEL[rangeKey].toLowerCase()}. Try a wider period.
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

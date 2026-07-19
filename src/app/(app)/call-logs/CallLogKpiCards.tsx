// ════════════════════════════════════════════════════════════════════════════
// CALL LOGS — KPI cards (Lalit P0, 2026-07-18)
//
// A live operations strip above the table. Every outcome card is a LINK that
// pins that status on the table; the currently pinned card is highlighted and
// links back to "all" so a second click clears it.
//
// URL-DRIVEN ON PURPOSE. Each card is a <Link> that rewrites the query string,
// so Next does a client-side navigation and re-renders the server component —
// the numbers refresh without a page reload, and the state stays shareable,
// bookmarkable, back-button-able, and identical to what the CSV export produces.
// A client-side fetch layer would refresh just as fast but would break all four
// of those, and would let the export drift from the screen again.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { CallOutcome } from "@prisma/client";
import { formatDuration, type CallKpis } from "./kpis";

/** Build the current URL with one param overridden (empty string removes it).
 *  Page resets to 1 on every card click — a drill-down must never land the user
 *  on page 7 of a result set that now has two pages. */
function withParam(sp: Record<string, string | undefined>, key: string, value: string): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") q.set(k, v);
  if (value) q.set(key, value);
  else q.delete(key);
  if (key !== "state") q.delete("state");
  const s = q.toString();
  return `/call-logs${s ? `?${s}` : ""}`;
}

interface CardDef {
  key: string;
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone: string;
  hint?: string;
}

export default function CallLogKpiCards({
  kpis,
  sp,
}: {
  kpis: CallKpis;
  sp: Record<string, string | undefined>;
}) {
  const pinned = sp.outcome ?? "";
  const statePinned = sp.state ?? "";
  const o = kpis.byOutcome;

  const outcomeCard = (key: CallOutcome, label: string, tone: string, hint?: string): CardDef => ({
    key,
    label,
    value: o[key],
    href: withParam(sp, "outcome", pinned === key ? "" : key),
    active: pinned === key,
    tone,
    hint,
  });

  const cards: CardDef[] = [
    {
      key: "__total",
      label: "Total Calls",
      value: kpis.total,
      href: withParam(sp, "outcome", ""),
      active: !pinned && statePinned !== "pending",
      tone: "text-slate-900 dark:text-slate-100",
      hint: "Resolved calls — unresolved dials excluded",
    },
    outcomeCard(CallOutcome.CONNECTED, "Connected / Completed", "text-emerald-600 dark:text-emerald-400",
      "One outcome covers both — a completed call IS a connected call"),
    outcomeCard(CallOutcome.NOT_PICKED, "Not Picked / No Answer", "text-amber-600 dark:text-amber-400"),
    outcomeCard(CallOutcome.BUSY, "Busy", "text-orange-600 dark:text-orange-400"),
    outcomeCard(CallOutcome.SWITCHED_OFF, "Switched Off", "text-slate-600 dark:text-slate-300"),
    outcomeCard(CallOutcome.WRONG_NUMBER, "Wrong Number", "text-rose-600 dark:text-rose-400"),
    outcomeCard(CallOutcome.NOT_INTERESTED, "Not Interested", "text-rose-600 dark:text-rose-400"),
    outcomeCard(CallOutcome.CALLBACK, "Callback", "text-sky-600 dark:text-sky-400"),
    // Telephony-only states. They exist in the enum and are counted correctly,
    // but nothing writes them until the AS Phone integration goes live — so they
    // read 0 today by design, not because the card is broken. The hint says so
    // rather than leaving an operator wondering.
    outcomeCard(CallOutcome.FAILED, "Failed", "text-red-600 dark:text-red-400",
      "Telephony-reported — populates once AS Phone is connected"),
    outcomeCard(CallOutcome.CANCELLED, "Cancelled", "text-red-600 dark:text-red-400",
      "Telephony-reported — populates once AS Phone is connected"),
    outcomeCard(CallOutcome.MISSED, "Missed", "text-red-600 dark:text-red-400",
      "Telephony-reported — populates once AS Phone is connected"),
    {
      key: "__pending",
      label: "Unresolved Dials",
      value: kpis.pending,
      href: withParam(sp, "state", statePinned === "pending" ? "" : "pending"),
      active: statePinned === "pending",
      tone: "text-violet-600 dark:text-violet-400",
      hint: "Call was tapped, outcome never logged. Counts as nothing in any statistic.",
    },
  ];

  const cov = kpis.durationCoverage;
  const covPct = kpis.total > 0 ? Math.round((cov.withDuration / kpis.total) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* ── Outcome breakdown — clickable drill-downs ───────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            title={c.hint}
            className={`rounded-lg border px-3 py-2 transition hover:shadow-sm ${
              c.active
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-500"
                : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600"
            }`}
          >
            <div className={`text-xl font-bold tabular-nums ${c.tone}`}>{c.value.toLocaleString()}</div>
            <div className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">{c.label}</div>
          </Link>
        ))}
      </div>

      {/* ── Derived stats — not drill-downs, so rendered as plain tiles ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
          <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatDuration(kpis.talkTimeSec)}
          </div>
          <div className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">
            Total Talk Time
            {/* Duration is typed in by the agent today, so this is a FLOOR, not a
                true total. Saying so on the tile stops it being read as complete
                and quietly compared against a telephony-era number later. */}
            <span className="block text-[10px] text-gray-400 dark:text-slate-500">
              from {cov.withDuration.toLocaleString()} of {kpis.total.toLocaleString()} calls ({covPct}%) with a logged duration
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
          <div className="text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatDuration(kpis.avgDurationSec)}
          </div>
          <div className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">
            Average Call Duration
            <span className="block text-[10px] text-gray-400 dark:text-slate-500">
              across calls that have a duration — not all calls
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
          <div className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {kpis.connectionRate}%
          </div>
          <div className="text-[11px] leading-tight text-gray-500 dark:text-slate-400">
            Connection Rate
            <span className="block text-[10px] text-gray-400 dark:text-slate-500">
              connected ÷ resolved calls
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

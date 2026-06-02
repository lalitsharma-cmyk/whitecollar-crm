"use client";
import { useState, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────
// Shared report date-range picker — used by /reports/ytd and (optionally)
// retrofitted onto the other report pages so the UX is consistent.
//
// Design rules:
//   - Thin client wrapper. Server pages still read `from`/`to` from
//     `searchParams` — this component only mutates the URL on Apply.
//   - Native `<input type="date">` for both ends (mobile-friendly,
//     no extra deps, works offline).
//   - Preset chips set both inputs at once. Apply still required so the
//     user can review the dates before submitting.
//   - Validation: from ≤ to ≤ today. We disable Apply if invalid and
//     show a small inline message instead of throwing.
//   - Preserves OTHER query params (e.g. ?agent=…) so retrofitting onto
//     existing pages doesn't break their filters.
// ─────────────────────────────────────────────────────────────────────────

export interface Preset {
  /** Stable key for React + querystring */
  key: string;
  /** Label shown on the chip */
  label: string;
  /** Returns { from, to } in YYYY-MM-DD given a base "today" reference */
  compute: (today: Date) => { from: string; to: string };
}

interface Props {
  defaultFrom?: string;
  defaultTo?: string;
  presets?: Preset[];
}

// Date math helpers ─────────────────────────────────────────────────────
// We do this in local time (the user's browser) — these dates are about
// "what day did this happen on my calendar", not absolute UTC instants.
// Server pages reading the YYYY-MM-DD then convert to UTC date bounds.

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}
function subDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() - n);
  return out;
}

// Default presets — match what's used elsewhere on the site. Pages can
// override via the `presets` prop if they want a different set.
export const DEFAULT_PRESETS: Preset[] = [
  {
    key: "30d",
    label: "30 days",
    compute: (today) => ({ from: toYmd(subDays(today, 30)), to: toYmd(today) }),
  },
  {
    key: "90d",
    label: "90 days",
    compute: (today) => ({ from: toYmd(subDays(today, 90)), to: toYmd(today) }),
  },
  {
    key: "month",
    label: "This month",
    compute: (today) => ({ from: toYmd(startOfMonth(today)), to: toYmd(today) }),
  },
  {
    key: "quarter",
    label: "This quarter",
    compute: (today) => ({ from: toYmd(startOfQuarter(today)), to: toYmd(today) }),
  },
  {
    key: "ytd",
    label: "This year (YTD)",
    compute: (today) => ({ from: toYmd(startOfYear(today)), to: toYmd(today) }),
  },
];

export default function ReportDateRangePicker({
  defaultFrom,
  defaultTo,
  presets = DEFAULT_PRESETS,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Memoise today so the value is stable across re-renders within this
  // session (otherwise the max= attribute jitters during typing).
  const today = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(today), [today]);

  const [from, setFrom] = useState<string>(defaultFrom ?? "");
  const [to, setTo] = useState<string>(defaultTo ?? todayYmd);

  // Validation: from ≤ to ≤ today. Empty `from` is treated as "not set yet"
  // — we let the user fill it in rather than blocking with red text from the
  // first paint.
  const invalid =
    !!from && !!to && (from > to || to > todayYmd);
  const invalidMsg =
    !from || !to
      ? null
      : from > to
      ? "From date is after To date"
      : to > todayYmd
      ? "To date can't be in the future"
      : null;

  function applyPreset(p: Preset) {
    const { from: f, to: t } = p.compute(today);
    setFrom(f);
    setTo(t);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid || !from || !to) return;
    // Preserve any OTHER query params (agent=, team=, etc) so retrofitting
    // this picker onto existing pages doesn't blow away their filters.
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="card p-3 sm:p-4 flex flex-col gap-3"
      aria-label="Report date range"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col">
          <label htmlFor="rdrp-from" className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
            From
          </label>
          <input
            id="rdrp-from"
            type="date"
            value={from}
            max={todayYmd}
            onChange={(e) => setFrom(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
          />
        </div>
        <div className="flex flex-col">
          <label htmlFor="rdrp-to" className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
            To
          </label>
          <input
            id="rdrp-to"
            type="date"
            value={to}
            max={todayYmd}
            onChange={(e) => setTo(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
          />
        </div>
        <button
          type="submit"
          disabled={invalid || !from || !to}
          className="btn btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply
        </button>
        {invalidMsg && (
          <span className="text-[11px] text-rose-700 font-medium">
            {invalidMsg}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold self-center mr-1">
          Quick:
        </span>
        {presets.map((p) => {
          const computed = p.compute(today);
          const active = from === computed.from && to === computed.to;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p)}
              className={`chip text-[11px] min-h-7 px-2.5 ${
                active ? "chip-warm" : "chip-lost"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </form>
  );
}

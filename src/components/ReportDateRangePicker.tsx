"use client";
import { useState, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import CRMDatePicker from "./CRMDatePicker";

// ─────────────────────────────────────────────────────────────────────────
// Shared report date-range picker — used by /reports/ytd and (optionally)
// retrofitted onto other report pages so the UX is consistent.
//
// Design rules:
//   - Thin client wrapper. Server pages still read `from`/`to` from
//     `searchParams` — this component only mutates the URL on Apply.
//   - CRMDatePicker (range mode) for visual calendar range selection.
//   - Preset chips set both ends at once; Apply still required before
//     the URL is pushed so the user can review or adjust.
//   - Preserves OTHER query params (e.g. ?agent=…).
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

function toYmd(d: Date): string {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfMonth(d: Date): Date   { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfQuarter(d: Date): Date { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
function startOfYear(d: Date): Date    { return new Date(d.getFullYear(), 0, 1); }
function subDays(d: Date, n: number): Date { const o = new Date(d); o.setDate(o.getDate() - n); return o; }

// Default presets ─────────────────────────────────────────────────────

export const DEFAULT_PRESETS: Preset[] = [
  { key: "30d",     label: "30 days",         compute: (t) => ({ from: toYmd(subDays(t, 30)),     to: toYmd(t) }) },
  { key: "90d",     label: "90 days",         compute: (t) => ({ from: toYmd(subDays(t, 90)),     to: toYmd(t) }) },
  { key: "month",   label: "This month",      compute: (t) => ({ from: toYmd(startOfMonth(t)),   to: toYmd(t) }) },
  { key: "quarter", label: "This quarter",    compute: (t) => ({ from: toYmd(startOfQuarter(t)), to: toYmd(t) }) },
  { key: "ytd",     label: "This year (YTD)", compute: (t) => ({ from: toYmd(startOfYear(t)),    to: toYmd(t) }) },
];

export default function ReportDateRangePicker({
  defaultFrom,
  defaultTo,
  presets = DEFAULT_PRESETS,
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  const today    = useMemo(() => new Date(), []);
  const todayYmd = useMemo(() => toYmd(today), [today]);

  const [from, setFrom] = useState<string>(defaultFrom ?? "");
  const [to,   setTo]   = useState<string>(defaultTo ?? todayYmd);

  function applyPreset(p: Preset) {
    const { from: f, to: t } = p.compute(today);
    setFrom(f);
    setTo(t);
  }

  function onApply() {
    if (!from || !to) return;
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("from", from);
    params.set("to", to);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="card p-3 sm:p-4 flex flex-col gap-3" aria-label="Report date range">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <span className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold block mb-1">
            Date Range
          </span>
          <CRMDatePicker
            mode="range"
            from={from}
            to={to}
            onRangeChange={(f, t) => { setFrom(f); setTo(t); }}
            maxToday
            triggerStyle="input"
            placeholder="Select date range"
            title="Select Report Range"
          />
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={!from || !to}
          className="btn btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold self-center mr-1">
          Quick:
        </span>
        {presets.map((p) => {
          const computed = p.compute(today);
          const active   = from === computed.from && to === computed.to;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p)}
              className={`chip text-[11px] min-h-7 px-2.5 ${active ? "chip-warm" : "chip-lost"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

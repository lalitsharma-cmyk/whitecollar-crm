"use client";
// GlobalDateFilter — global date/date-range filter for CRM dashboard metrics.
//
// How it works:
//   1. Renders a small trigger button in the header showing the active period.
//   2. Opens a dropdown/bottom-sheet with preset ranges + custom date inputs.
//   3. On selection, calls router.replace() to add ?from=YYYY-MM-DD&to=YYYY-MM-DD
//      to the current URL, preserving all other search params (e.g. ?team=Dubai).
//   4. Any Server Component page (dashboard, reports) can read those params and
//      scope its DB queries to the selected period.
//
// Default: today (in IST). If no params are set, queries behave as before.
//
// NOTE: this component uses useSearchParams() and MUST be wrapped in <Suspense>
// at the point of use — see MobileShell.tsx.

import React, { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ── IST helpers (server is UTC; we display in IST) ────────────────────────
const IST_MS = 5.5 * 60 * 60 * 1000;
function istNow(): Date { return new Date(Date.now() + IST_MS); }
function fmtISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

type Preset = "today" | "yesterday" | "this-week" | "this-month";

function presetRange(p: Preset): { from: string; to: string } {
  const now = istNow();
  const today = fmtISO(now);
  switch (p) {
    case "today":     return { from: today, to: today };
    case "yesterday": {
      const s = fmtISO(new Date(now.getTime() - 86400000));
      return { from: s, to: s };
    }
    case "this-week": {
      const dow = now.getUTCDay();
      const mon = new Date(now.getTime() - ((dow + 6) % 7) * 86400000);
      return { from: fmtISO(mon), to: today };
    }
    case "this-month": {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: fmtISO(first), to: today };
    }
  }
}

/** Human-readable label for a from–to range (short, for header display) */
function rangeLabel(from: string | null, to: string | null): string {
  if (!from || !to) return "Today";
  const now    = istNow();
  const today  = fmtISO(now);
  const yest   = fmtISO(new Date(now.getTime() - 86400000));
  const dow    = now.getUTCDay();
  const monStr = fmtISO(new Date(now.getTime() - ((dow + 6) % 7) * 86400000));
  const fom    = fmtISO(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));

  if (from === today  && to === today)  return "Today";
  if (from === yest   && to === yest)   return "Yesterday";
  if (from === monStr && to === today)  return "This Week";
  if (from === fom    && to === today)  return "This Month";
  if (from === to) return displayDate(from);
  // Custom range — compact form
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", timeZone: "UTC",
    });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

const PRESETS: { id: Preset; label: string; desc: string }[] = [
  { id: "today",      label: "Today",      desc: "Just today's numbers" },
  { id: "yesterday",  label: "Yesterday",  desc: "Yesterday's activity" },
  { id: "this-week",  label: "This Week",  desc: "Monday to today" },
  { id: "this-month", label: "This Month", desc: "First of month to today" },
];

export default function GlobalDateFilter() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [open,        setOpen]        = useState(false);
  const [showCustom,  setShowCustom]  = useState(false);
  const [customFrom,  setCustomFrom]  = useState("");
  const [customTo,    setCustomTo]    = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const from  = searchParams.get("from");
  const to    = searchParams.get("to");
  const label = rangeLabel(from, to);

  // Is a non-default (non-today) filter active?
  const today        = fmtISO(istNow());
  const filterActive = !!(from || to) && !(from === today && to === today);

  function applyRange(f: string, t: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to",   t.length && t >= f ? t : f);
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
    setShowCustom(false);
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  function applyCustom() {
    if (!customFrom) return;
    applyRange(customFrom, customTo || customFrom);
  }

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  // ── Panel body (shared by mobile + desktop) ────────────────────────────
  const panelBody = (
    <div className="space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 px-2 pb-2 pt-1">
        Filter by date range
      </p>

      {PRESETS.map(p => {
        const { from: pf, to: pt } = presetRange(p.id);
        const active = from === pf && to === pt;
        return (
          <button
            key={p.id}
            onClick={() => applyRange(pf, pt)}
            className={[
              "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between gap-2",
              active
                ? "bg-[#0b1a33] text-white font-semibold"
                : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200",
            ].join(" ")}
          >
            <span>{p.label}</span>
            <span className={`text-[10px] ${active ? "text-white/70" : "text-slate-400 dark:text-slate-500"}`}>
              {p.desc}
            </span>
          </button>
        );
      })}

      {/* Custom range */}
      <button
        onClick={() => setShowCustom(s => !s)}
        className={[
          "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between",
          showCustom
            ? "bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-medium"
            : "hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200",
        ].join(" ")}
      >
        <span>Custom Range</span>
        <span className="text-slate-400 text-xs">{showCustom ? "▲" : "▼"}</span>
      </button>

      {showCustom && (
        <div className="px-2 pt-2 pb-1 space-y-2 bg-slate-50 dark:bg-slate-700/40 rounded-lg">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#c9a24b]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">To</label>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={e => setCustomTo(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#c9a24b]"
              />
            </div>
          </div>
          <button
            onClick={applyCustom}
            disabled={!customFrom}
            className="w-full py-2 rounded-lg bg-[#c9a24b] text-[#0b1a33] font-bold text-sm hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Apply
          </button>
        </div>
      )}

      {/* Reset button when non-today filter is active */}
      {filterActive && (
        <button
          onClick={clearFilter}
          className="w-full text-center px-3 py-2 rounded-lg text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors mt-1"
        >
          ↩ Reset to Today
        </button>
      )}
    </div>
  );

  return (
    <div ref={panelRef} className="relative">
      {/* ── Trigger button ── */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={`Date filter: ${label}`}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-9"
      >
        <Calendar className="w-4 h-4 flex-none opacity-70" />
        {/* Label visible on medium+ screens */}
        <span className="hidden md:inline text-xs font-medium leading-none max-w-[110px] truncate">
          {label}
        </span>
        <ChevronDown className="w-3 h-3 flex-none opacity-50 hidden md:block" />
        {/* Gold dot when non-today filter is active */}
        {filterActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-[#c9a24b] flex-none" />
        )}
      </button>

      {open && (
        <>
          {/* Mobile: bottom-sheet */}
          <div className="sm:hidden fixed inset-0 z-[60] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div
              className="relative z-10 bg-white dark:bg-slate-800 rounded-t-2xl p-4 shadow-2xl"
              style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Filter by Date</span>
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              {panelBody}
            </div>
          </div>

          {/* Desktop: right-anchored dropdown */}
          <div className="hidden sm:block absolute right-0 top-full mt-2 z-[60] w-72 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-3">
            {panelBody}
          </div>
        </>
      )}
    </div>
  );
}

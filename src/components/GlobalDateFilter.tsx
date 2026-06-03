"use client";
// GlobalDateFilter — global date-range filter for CRM counts and metrics.
//
// Two date pickers (From / To) + Apply button. That's all.
// No preset buttons. If user wants "today", they pick today→today.
// If user wants "this month", they pick 1st→today. One system, zero special cases.
//
// Mechanism:
//   Apply → router.replace() sets ?from=YYYY-MM-DD&to=YYYY-MM-DD in the URL.
//   Clear → removes those params (= All Time, no restriction).
//   Dashboard and other pages read these params server-side and scope their queries.
//
// Header label:
//   No filter  → "All Time"
//   With range → "04 Jun 2026 → 04 Jun 2026"
//
// MUST be wrapped in <Suspense> at point of use (uses useSearchParams).

import React, { useEffect, useRef, useState } from "react";
import { Calendar, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export default function GlobalDateFilter() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [open,      setOpen]      = useState(false);
  const [localFrom, setLocalFrom] = useState("");
  const [localTo,   setLocalTo]   = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  const from      = searchParams.get("from");
  const to        = searchParams.get("to");
  const hasFilter = !!(from && to);

  // Pre-fill pickers with current filter when opening
  function handleOpen() {
    setLocalFrom(from ?? "");
    setLocalTo(to ?? "");
    setOpen(true);
  }

  function applyRange() {
    if (!localFrom || !localTo) return;
    const f = localFrom;
    const t = localTo >= localFrom ? localTo : localFrom;
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", f);
    params.set("to",   t);
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function clearFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function h(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const headerLabel = hasFilter
    ? `${displayDate(from!)} → ${displayDate(to!)}`
    : "All Time";

  const panelBody = (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
            From
          </label>
          <input
            type="date"
            value={localFrom}
            onChange={e => setLocalFrom(e.target.value)}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#c9a24b] focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
            To
          </label>
          <input
            type="date"
            value={localTo}
            min={localFrom}
            onChange={e => setLocalTo(e.target.value)}
            className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#c9a24b] focus:border-transparent"
          />
        </div>
      </div>

      <button
        onClick={applyRange}
        disabled={!localFrom || !localTo}
        className="w-full py-2.5 rounded-lg bg-[#c9a24b] text-[#0b1a33] font-bold text-sm hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Apply
      </button>

      {hasFilter && (
        <button
          onClick={clearFilter}
          className="w-full py-2 rounded-lg text-xs text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border border-dashed border-slate-200 dark:border-slate-600"
        >
          Clear filter — show All Time
        </button>
      )}
    </div>
  );

  return (
    <div ref={panelRef} className="relative">
      {/* ── Trigger button ── */}
      <button
        onClick={handleOpen}
        aria-label={`Date filter: ${headerLabel}`}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors min-h-9"
      >
        <Calendar className="w-4 h-4 flex-none opacity-70" />
        <span className="hidden md:inline text-xs font-medium leading-none max-w-[180px] truncate">
          {headerLabel}
        </span>
        {/* Gold × badge to clear inline without opening dropdown */}
        {hasFilter && (
          <span
            role="button"
            aria-label="Clear filter"
            onClick={e => { e.stopPropagation(); clearFilter(); }}
            className="flex-none w-4 h-4 rounded-full bg-[#c9a24b] text-white flex items-center justify-center hover:bg-amber-600"
          >
            <X className="w-2.5 h-2.5" />
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile: full-width bottom-sheet */}
          <div className="sm:hidden fixed inset-0 z-[60] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div
              className="relative z-10 bg-white dark:bg-slate-800 rounded-t-2xl p-5 shadow-2xl"
              style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-slate-800 dark:text-slate-100">📅 Date Range Filter</span>
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              {panelBody}
            </div>
          </div>

          {/* Desktop: right-anchored dropdown below the icon */}
          <div className="hidden sm:block absolute right-0 top-full mt-2 z-[60] w-64 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 p-4">
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm mb-4">📅 Date Range Filter</p>
            {panelBody}
          </div>
        </>
      )}
    </div>
  );
}

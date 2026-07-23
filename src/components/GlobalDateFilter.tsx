"use client";
// GlobalDateFilter — global date-range filter.
//
// Behaviour:
//   • On first load with no URL params, auto-sets today → today.
//   • Single date (from === to): label shows "4 Jun 2026" (once, not "from → to").
//   • Date range: label shows "1 Jun → 4 Jun 2026" (compact).
//   • Calendar has built-in month + year selectors; no future dates selectable.
//   • "Reset to today" replaces the old "Clear filter" so there's no no-filter
//     state — every page always has a date context.
//
// Apply → router.replace() sets ?from=YYYY-MM-DD&to=YYYY-MM-DD.
// MUST be wrapped in <Suspense> at point of use (uses useSearchParams).

import React, { useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDismiss } from "@/lib/useDismiss";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Today in IST (UTC+5:30)
function todayIST(): string {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function displayShort(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAY_HEADERS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

// ─── Single-calendar range picker ───────────────────────────────────────────
// Phase: "from" → next tap sets start (and resets end to same day)
//        "to"   → next tap sets end if ≥ start, else resets start
interface RangeCalProps {
  from: string; to: string;
  onFrom: (v: string) => void; onTo: (v: string) => void;
  max: string;
}
function RangeCalendar({ from, to, onFrom, onTo, max }: RangeCalProps) {
  const today = max;
  const initDate = from || today;
  const [viewYear,  setViewYear]  = useState(Number(initDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(initDate.slice(5, 7)) - 1); // 0-based
  // "from" = selecting start; "to" = selecting end
  const [phase, setPhase] = useState<"from" | "to">("from");

  const todayYear  = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7)) - 1;
  const years = Array.from({ length: 7 }, (_, i) => todayYear - 5 + i).filter(y => y <= todayYear);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewYear === todayYear && viewMonth >= todayMonth) return; // block future months
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  const firstDay   = new Date(Date.UTC(viewYear, viewMonth, 1)).getDay();
  const daysInMo   = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getDate();

  function iso(d: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function handleDay(dateStr: string) {
    if (phase === "from") {
      onFrom(dateStr); onTo(dateStr);
      setPhase("to");
    } else {
      if (dateStr >= from) { onTo(dateStr); setPhase("from"); }
      else { onFrom(dateStr); onTo(dateStr); setPhase("to"); }
    }
  }

  return (
    <div className="select-none">
      {/* Month/year header */}
      <div className="flex items-center gap-1 mb-3">
        <button type="button" onClick={prevMonth}
          className="p-1 rounded hover:bg-slate-100 text-slate-500 flex-none">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 flex items-center justify-center gap-1">
          <select value={viewMonth} onChange={e => setViewMonth(Number(e.target.value))}
            className="text-sm font-semibold bg-transparent border-none outline-none cursor-pointer
                       text-slate-700 dark:text-slate-200 hover:text-amber-600 pr-0.5">
            {MONTHS.map((mo, i) => <option key={mo} value={i}>{mo}</option>)}
          </select>
          <select value={viewYear} onChange={e => setViewYear(Number(e.target.value))}
            className="text-sm font-semibold bg-transparent border-none outline-none cursor-pointer
                       text-slate-700 dark:text-slate-200 hover:text-amber-600">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button type="button" onClick={nextMonth}
          disabled={viewYear === todayYear && viewMonth >= todayMonth}
          className="p-1 rounded hover:bg-slate-100 text-slate-500 flex-none
                     disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Phase hint */}
      <div className="text-center text-[10px] text-amber-600 font-medium mb-2">
        {phase === "from" ? "Tap start date" : "Tap end date (or tap same day for single-day)"}
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_HEADERS.map(d => (
          <div key={d} className="text-center text-[10px] text-slate-400 font-medium">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMo }, (_, i) => {
          const d      = i + 1;
          const ds     = iso(d);
          const isFut  = ds > max;
          const isFr   = ds === from;
          const isTo   = ds === to;
          const isSel  = isFr || isTo;
          const inRng  = from && to && from !== to && ds > from && ds < to;
          const isToday = ds === today;

          return (
            <button
              key={ds}
              type="button"
              disabled={isFut}
              onClick={() => !isFut && handleDay(ds)}
              className={[
                "h-8 w-8 mx-auto my-0.5 flex items-center justify-center text-[12px] transition-colors",
                isFut ? "text-slate-200 cursor-not-allowed" : "cursor-pointer",
                isSel ? "rounded-full bg-[#c9a24b] text-white font-bold" : "",
                inRng ? "rounded-none bg-amber-100 text-amber-800" : "",
                !isSel && !inRng && !isFut ? "rounded-full hover:bg-amber-100 hover:text-amber-700" : "",
                isToday && !isSel ? "font-bold text-amber-600" : "",
              ].join(" ")}
            >
              {isToday && !isSel
                ? <span className="relative flex items-center justify-center w-full h-full">
                    {d}
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400" />
                  </span>
                : d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function GlobalDateFilter() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const today        = todayIST();

  const [open,      setOpen]      = useState(false);
  const [localFrom, setLocalFrom] = useState(today);
  const [localTo,   setLocalTo]   = useState(today);

  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  function handleOpen() {
    setLocalFrom(from ?? today);
    setLocalTo(to ?? today);
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

  function resetToday() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", today);
    params.set("to",   today);
    router.replace(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  // Close ONLY on a genuine outside interaction — never when a text selection that
  // began inside the panel (e.g. a date input) happens to end outside (useDismiss).
  const panelRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  // ── Header label ──
  const headerLabel = useMemo(() => {
    const f = from ?? today;
    const t = to   ?? today;
    if (f === t) {
      // Single day — show just the date, not "X → X"
      return f === today ? "Today" : displayDate(f);
    }
    // Range — compact "1 Jun → 4 Jun 2026"
    return `${displayShort(f)} → ${displayDate(t)}`;
  }, [from, to, today]);

  const isToday = from === today && to === today;

  const panelBody = (
    <div className="space-y-3">
      {/* Selected range summary chips */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`px-2.5 py-1 rounded-full font-medium text-[11px] border ${
          from ? "bg-amber-50 border-amber-300 text-amber-800" : "border-dashed border-slate-300 text-slate-400"
        }`}>
          From: {from ? displayDate(from) : "—"}
        </span>
        <span className="text-slate-300">→</span>
        <span className={`px-2.5 py-1 rounded-full font-medium text-[11px] border ${
          to ? "bg-amber-50 border-amber-300 text-amber-800" : "border-dashed border-slate-300 text-slate-400"
        }`}>
          To: {to ? displayDate(to) : "—"}
        </span>
      </div>

      <RangeCalendar
        from={localFrom}
        to={localTo}
        onFrom={setLocalFrom}
        onTo={setLocalTo}
        max={today}
      />

      {/* Selected range summary */}
      {localFrom && localTo && (
        <div className="text-center text-xs bg-amber-50 rounded-lg px-3 py-1.5 border border-amber-100 text-amber-800">
          {localFrom === localTo ? displayDate(localFrom) : `${displayShort(localFrom)} → ${displayDate(localTo)}`}
        </div>
      )}

      <button
        onClick={applyRange}
        disabled={!localFrom || !localTo}
        className="w-full py-2.5 rounded-lg bg-[#c9a24b] text-[#0b1a33] font-bold text-sm hover:bg-amber-400
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Apply
      </button>

      {!isToday && (
        <button
          onClick={resetToday}
          className="w-full py-2 rounded-lg text-xs text-slate-400 hover:text-amber-600 hover:bg-amber-50
                     transition-colors border border-dashed border-slate-200"
        >
          Reset to today
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
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10
                   transition-colors min-h-9"
      >
        <Calendar className="w-4 h-4 flex-none opacity-70" />
        {/* suppressHydrationWarning: headerLabel derives from todayIST() (Date.now()
            at render), so the SSR (server UTC) and client (browser tz) values can
            differ across a day/minute boundary → React #418. The label is genuinely
            time-dependent, so suppress the benign mismatch on this node. */}
        <span suppressHydrationWarning className="hidden md:inline text-xs font-medium leading-none max-w-[200px] truncate">
          {headerLabel}
        </span>
        {/* Gold × — only shown when the active filter is NOT today */}
        {!isToday && (
          <span
            role="button"
            aria-label="Reset to today"
            onClick={e => { e.stopPropagation(); resetToday(); }}
            className="flex-none w-4 h-4 rounded-full bg-[#c9a24b] text-white flex items-center justify-center
                       hover:bg-amber-600"
          >
            <X className="w-2.5 h-2.5" />
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile: bottom-sheet */}
          <div className="sm:hidden fixed inset-0 z-[60] flex flex-col justify-end">
            <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div
              className="relative z-10 bg-white dark:bg-slate-800 rounded-t-2xl p-5 shadow-2xl"
              style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-bold text-slate-800 dark:text-slate-100">📅 Select Date</span>
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>
              {panelBody}
            </div>
          </div>

          {/* Desktop: dropdown */}
          <div className="hidden sm:block absolute right-0 top-full mt-2 z-[60] w-72
                          bg-white dark:bg-slate-800 rounded-xl shadow-2xl
                          border border-slate-200 dark:border-slate-700 p-4">
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm mb-3">📅 Select Date</p>
            {panelBody}
          </div>
        </>
      )}
    </div>
  );
}

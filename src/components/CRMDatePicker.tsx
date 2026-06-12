"use client";
/**
 * CRMDatePicker — single unified date/datetime/range picker for the CRM.
 *
 * Features:
 *   • Visual calendar grid (no native browser date picker)
 *   • Single-date and date-range selection modes
 *   • Optional time picker (HH : MM  AM/PM) for datetime fields
 *   • Bottom-sheet on mobile (<640 px), centered modal on desktop
 *   • Backdrop-click and Escape-key close
 *   • futureOnly — blocks past dates for scheduling fields
 *   • maxToday — upper bound = today (for report filters)
 *   • Two callback patterns:
 *       – onChange / onRangeChange : fire immediately → calendar auto-closes
 *       – onConfirm / onRangeConfirm : async, shows Save / Apply buttons
 *   • Trigger styles: "tile" (scheduling card), "input" (report filters)
 *   • Display format: "DD MMM YYYY" / "DD MMM YYYY, H:MM AM/PM IST"
 *
 * All timezone logic targets IST (UTC+05:30).
 */
import { useState, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Pure utilities
// ─────────────────────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, "0"); }

function nowIST(): Date {
  const now = new Date();
  return new Date(now.getTime() + (now.getTimezoneOffset() + 330) * 60_000);
}
function todayIST(): string {
  const d = nowIST();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LONG_MONTHS  = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
const DOW_LABELS   = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function fmtDate(s: string): string {
  if (!s) return "";
  const parts = s.split("-");
  const y = parts[0] ?? "";
  const mo = parseInt(parts[1] ?? "0", 10) - 1;
  const d = parts[2] ?? "";
  if (mo < 0 || mo > 11 || !y || !d) return "";
  return `${d} ${SHORT_MONTHS[mo]} ${y}`;
}

function parse12h(t: string): { h: number; m: number; ampm: "AM" | "PM" } {
  const segs = (t || "10:00").split(":");
  const h24 = parseInt(segs[0] ?? "10", 10) || 0;
  return {
    h:    h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24,
    m:    parseInt(segs[1] ?? "00", 10) || 0,
    ampm: h24 < 12 ? "AM" : "PM",
  };
}

function to24h(h12: number, m: number, ampm: "AM" | "PM"): string {
  const h = Math.max(1, Math.min(12, h12 || 1));
  let h24 = h;
  if (ampm === "AM") { if (h24 === 12) h24 = 0; }
  else               { if (h24 !== 12) h24 += 12; }
  return `${pad(h24)}:${pad(Math.max(0, Math.min(59, m)))}`;
}

/** Human display: "DD MMM YYYY" or "DD MMM YYYY, H:MM AM/PM IST" */
export function fmtDateDisplay(v: string, withTime: boolean): string {
  if (!v) return "";
  const segs = v.split("T");
  const ds   = fmtDate(segs[0] ?? "");
  if (!ds) return "";
  if (!withTime || !segs[1]) return ds;
  const { h, m, ampm } = parse12h(segs[1]);
  return `${ds}, ${h}:${pad(m)} ${ampm} IST`;
}

/** Build a 42-cell array of "YYYY-MM-DD" strings for the given month. */
function buildGrid(year: number, month: number): string[] {
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDim     = new Date(year, month, 0).getDate();
  const grid: string[] = [];

  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 1, prevDim - i);
    grid.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    grid.push(`${year}-${pad(month + 1)}-${pad(d)}`);
  }
  let nd = 1;
  while (grid.length < 42) {
    const d = new Date(year, month + 1, nd++);
    grid.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return grid;
}

// ─────────────────────────────────────────────────────────────────────────────
// CalendarGrid — internal display component
// ─────────────────────────────────────────────────────────────────────────────

interface GridProps {
  year: number; month: number;
  onNav: (y: number, m: number) => void;
  mode: "single" | "range";
  selected?: string;
  onSelect?: (ds: string) => void;
  rangeFrom?: string; rangeTo?: string; hoverDate?: string;
  onRangeClick?: (ds: string) => void;
  onHover?: (ds: string) => void;
  minDate?: string; maxDate?: string;
}

function CalendarGrid({
  year, month, onNav,
  mode, selected, onSelect,
  rangeFrom, rangeTo, hoverDate, onRangeClick, onHover,
  minDate, maxDate,
}: GridProps) {
  const grid    = buildGrid(year, month);
  const today   = todayIST();
  const curPfx  = `${year}-${pad(month + 1)}`;
  const effEnd  = rangeTo
    || (rangeFrom && hoverDate && hoverDate >= rangeFrom ? hoverDate : undefined);

  function prev() { month === 0  ? onNav(year - 1, 11)    : onNav(year, month - 1); }
  function next() { month === 11 ? onNav(year + 1, 0)     : onNav(year, month + 1); }

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={prev} aria-label="Previous month"
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
          {LONG_MONTHS[month]} {year}
        </span>
        <button type="button" onClick={next} aria-label="Next month"
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {DOW_LABELS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-gray-400 dark:text-slate-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {grid.map((ds, i) => {
          const isCurMonth = ds.startsWith(curPfx);
          const isToday    = ds === today;
          const isSel      = mode === "single" && ds === selected;
          const isStart    = mode === "range" && ds === rangeFrom;
          const isEnd      = mode === "range" && ds === rangeTo;
          const inRange    = mode === "range" && rangeFrom && effEnd
            && ds > rangeFrom && ds < effEnd;
          const disabled   = (!!minDate && ds < minDate) || (!!maxDate && ds > maxDate);
          const dayNum     = parseInt(ds.split("-")[2] ?? "1", 10);

          let cls = "flex items-center justify-center h-9 text-sm cursor-pointer transition-colors rounded-lg ";

          if (disabled) {
            cls += "text-gray-200 dark:text-slate-700 cursor-not-allowed";
          } else if (isSel || isStart || isEnd) {
            cls += "bg-[#0b1a33] dark:bg-blue-700 text-white font-semibold";
          } else if (inRange) {
            cls += "bg-[#0b1a33]/10 dark:bg-blue-900/30 text-[#0b1a33] dark:text-blue-200 rounded-none";
          } else if (isToday && isCurMonth) {
            cls += "font-bold ring-1 ring-[#0b1a33] dark:ring-slate-400 text-[#0b1a33] dark:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700";
          } else if (isCurMonth) {
            cls += "text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700";
          } else {
            cls += "text-gray-300 dark:text-slate-600";
          }

          return (
            <button
              key={i} type="button" disabled={disabled}
              onClick={() => !disabled && (mode === "single" ? onSelect?.(ds) : onRangeClick?.(ds))}
              onMouseEnter={() => !disabled && onHover?.(ds)}
              className={cls}
            >
              {dayNum}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TimePicker — HH : MM  [AM/PM]
// ─────────────────────────────────────────────────────────────────────────────

function TimePicker({
  time, onChange, disabled,
}: { time: string; onChange: (t: string) => void; disabled?: boolean }) {
  const { h, m, ampm } = parse12h(time);

  // Local draft for the minute input — prevents "0" being immediately
  // re-padded to "00" (filling maxLength=2) and blocking the second digit.
  const [minRaw, setMinRaw] = useState(pad(m));
  const isMinFocused = useRef(false);
  useEffect(() => {
    if (!isMinFocused.current) setMinRaw(pad(m));
  }, [m]);

  const inputCls = [
    "border border-gray-200 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200",
    "rounded-lg text-sm text-center w-12 h-11",
    disabled ? "opacity-40 cursor-not-allowed bg-gray-50" : "bg-white",
  ].join(" ");

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
      <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 tracking-widest mb-2">
        ⏰ TIME (IST)
      </p>
      <div className="flex items-center gap-2">
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={String(h)} maxLength={2} aria-label="Hour" disabled={disabled}
          onChange={e => {
            const n = Math.max(1, Math.min(12, parseInt(e.target.value.replace(/\D/g, ""), 10) || 1));
            onChange(to24h(n, m, ampm));
          }}
          onFocus={e => e.target.select()}
          className={inputCls}
        />
        <span className="text-gray-400 dark:text-slate-500 font-bold select-none">:</span>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*"
          value={minRaw} maxLength={2} aria-label="Minute" disabled={disabled}
          onChange={e => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
            setMinRaw(digits);
            if (digits.length === 2) {
              const n = parseInt(digits, 10);
              if (n >= 0 && n <= 59) onChange(to24h(h, n, ampm));
            }
          }}
          onFocus={e => { isMinFocused.current = true; e.target.select(); }}
          onBlur={() => {
            isMinFocused.current = false;
            const n = Math.min(59, parseInt(minRaw.replace(/\D/g, ""), 10) || 0);
            setMinRaw(pad(n));
            onChange(to24h(h, n, ampm));
          }}
          className={inputCls}
        />
        <button
          type="button" disabled={disabled}
          onClick={() => onChange(to24h(h, m, ampm === "AM" ? "PM" : "AM"))}
          className={[
            "h-11 px-3 rounded-lg border font-semibold text-sm transition-colors min-w-[3.5rem]",
            disabled
              ? "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
              : ampm === "AM"
              ? "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 active:bg-blue-200 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-300"
              : "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 active:bg-amber-200 dark:bg-amber-950 dark:border-amber-700 dark:text-amber-300",
          ].join(" ")}
        >
          {ampm}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar icon SVG
// ─────────────────────────────────────────────────────────────────────────────

function CalIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8"  y1="2" x2="8"  y2="6"/>
      <line x1="3"  y1="10" x2="21" y2="10"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CRMDatePicker — main exported component
// ─────────────────────────────────────────────────────────────────────────────

export interface CRMDatePickerProps {
  /** "single" (default) or "range" */
  mode?: "single" | "range";

  // ── Single-date ────────────────────────────────────────────────────────────
  /** Current value: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" */
  value?: string;
  /** Fires immediately on day select → calendar auto-closes */
  onChange?: (v: string) => void;
  /** Async; shows Save / Cancel buttons inside the sheet */
  onConfirm?: (v: string) => Promise<void> | void;

  // ── Date range ─────────────────────────────────────────────────────────────
  from?: string; to?: string; // "YYYY-MM-DD"
  /** Fires immediately after both dates are picked */
  onRangeChange?: (from: string, to: string) => void;
  /** Async; shows Apply / Cancel buttons inside the sheet */
  onRangeConfirm?: (from: string, to: string) => Promise<void> | void;

  // ── Options ────────────────────────────────────────────────────────────────
  withTime?:   boolean;  // show HH:MM AM/PM below calendar
  futureOnly?: boolean;  // disable past dates
  maxToday?:   boolean;  // disable future dates (report filters)

  // ── Display ────────────────────────────────────────────────────────────────
  label?:       string;  // tile label / modal title prefix
  title?:       string;  // explicit modal header (overrides derived title)
  placeholder?: string;

  // ── Trigger style ──────────────────────────────────────────────────────────
  /** "tile" = colored block (scheduling card tiles) */
  /** "input" = full-width input box (report filters, forms) */
  triggerStyle?: "tile" | "input";
  /** "primary" = emerald (Follow-up), "default" = neutral */
  tileVariant?: "primary" | "default";
}

export default function CRMDatePicker({
  mode = "single",
  value = "", onChange, onConfirm,
  from: fromProp = "", to: toProp = "",
  onRangeChange, onRangeConfirm,
  withTime  = false,
  futureOnly = false,
  maxToday   = false,
  label, title, placeholder = "Not set",
  triggerStyle = "input",
  tileVariant  = "default",
}: CRMDatePickerProps) {

  // ── Sheet state ────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);

  // ── Calendar navigation ────────────────────────────────────────────────────
  function initYear(seed: string)  {
    const s = seed || todayIST();
    return parseInt(s.split("-")[0] ?? "2026", 10);
  }
  function initMonth(seed: string) {
    const s = seed || todayIST();
    return parseInt(s.split("-")[1] ?? "1", 10) - 1;
  }

  const [viewYear,  setViewYear]  = useState(() => initYear( (mode === "range" ? fromProp : value).split("T")[0] ?? ""));
  const [viewMonth, setViewMonth] = useState(() => initMonth((mode === "range" ? fromProp : value).split("T")[0] ?? ""));

  // ── Single-date draft ──────────────────────────────────────────────────────
  const [draftDate, setDraftDate] = useState(() => (value ?? "").split("T")[0] ?? "");
  const [draftTime, setDraftTime] = useState(() => (value ?? "").split("T")[1] ?? "10:00");

  // ── Range draft ────────────────────────────────────────────────────────────
  const [draftFrom,  setDraftFrom]  = useState(fromProp ?? "");
  const [draftTo,    setDraftTo]    = useState(toProp   ?? "");
  const [rangeStep,  setRangeStep]  = useState<"from" | "to">("from");
  const [hoverDate,  setHoverDate]  = useState("");

  // ── Save state ─────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string | null>(null);

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closePicker(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // ── Open / close ───────────────────────────────────────────────────────────
  function openPicker() {
    if (mode === "single") {
      const datePart = (value ?? "").split("T")[0] ?? "";
      const timePart = (value ?? "").split("T")[1] ?? "10:00";
      setDraftDate(datePart);
      setDraftTime(timePart || "10:00");
      const seed = datePart || todayIST();
      setViewYear(initYear(seed));
      setViewMonth(initMonth(seed));
    } else {
      setDraftFrom(fromProp ?? "");
      setDraftTo(toProp ?? "");
      setRangeStep("from");
      setHoverDate("");
      const seed = fromProp || todayIST();
      setViewYear(initYear(seed));
      setViewMonth(initMonth(seed));
    }
    setErr(null);
    setOpen(true);
  }

  function closePicker() { setOpen(false); setErr(null); }

  // ── Day-select handlers ────────────────────────────────────────────────────
  function handleDaySelect(ds: string) {
    setDraftDate(ds);
    if (!onConfirm) {
      // Immediate mode: fire onChange and close
      const combined = withTime ? `${ds}T${draftTime}` : ds;
      onChange?.(combined);
      closePicker();
    }
  }

  function handleRangeClick(ds: string) {
    if (rangeStep === "from" || !draftFrom || ds < draftFrom) {
      setDraftFrom(ds);
      setDraftTo("");
      setRangeStep("to");
    } else {
      setDraftTo(ds);
      if (!onRangeConfirm) {
        onRangeChange?.(draftFrom, ds);
        closePicker();
      }
      // else: stay open, wait for Apply
    }
  }

  // ── Save / Apply ───────────────────────────────────────────────────────────
  async function handleSave() {
    if (busy) return;
    const combined = withTime ? `${draftDate}T${draftTime}` : draftDate;
    if (onConfirm) {
      setBusy(true); setErr(null);
      try   { await onConfirm(combined); closePicker(); }
      catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
      finally   { setBusy(false); }
    }
  }

  async function handleApply() {
    if (busy || !draftFrom || !draftTo) return;
    setBusy(true); setErr(null);
    try {
      if (onRangeConfirm) { await onRangeConfirm(draftFrom, draftTo); }
      else                  { onRangeChange?.(draftFrom, draftTo); }
      closePicker();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  // ── Constraints ────────────────────────────────────────────────────────────
  const minDate = futureOnly ? todayIST() : undefined;
  const maxDate = maxToday   ? todayIST() : undefined;

  // ── Display strings ────────────────────────────────────────────────────────
  const singleDisplay = value ? fmtDateDisplay(value, withTime)  : null;
  const rangeDisplay  = fromProp && toProp
    ? `${fmtDate(fromProp)} — ${fmtDate(toProp)}`
    : null;
  const displayStr = mode === "single" ? singleDisplay : rangeDisplay;

  // ── Footer buttons? ────────────────────────────────────────────────────────
  const hasSaveBtn  = mode === "single" && !!onConfirm;
  const hasApplyBtn = mode === "range"  && (!!onRangeConfirm || (!!draftFrom && !!draftTo && !onRangeChange));
  const showFooter  = hasSaveBtn || hasApplyBtn;
  const canAction   = mode === "range" ? (!!draftFrom && !!draftTo) : !!draftDate;

  // ── Modal title ────────────────────────────────────────────────────────────
  const modalTitle = title
    ?? (mode === "range" ? "Select Date Range"
      : label ? `Set ${label.replace(/^[^\w\d]+/, "").trim()}` : "Select Date");

  // ── Range hint ─────────────────────────────────────────────────────────────
  const rangeHint = mode === "range" && open
    ? rangeStep === "from"
      ? "Tap start date"
      : draftFrom ? `From ${fmtDate(draftFrom)} — tap end date` : ""
    : null;

  // ── Trigger ────────────────────────────────────────────────────────────────
  const isPrimary = triggerStyle === "tile" && tileVariant === "primary";

  const labelEl = label && (
    <span className={[
      "text-xs block mb-0.5",
      isPrimary
        ? "font-semibold text-emerald-700 dark:text-emerald-400"
        : "font-medium text-gray-500 dark:text-slate-400",
    ].join(" ")}>
      {label}
    </span>
  );

  const valueEl = (
    <span className={`text-sm ${displayStr
      ? "font-medium text-gray-800 dark:text-slate-200"
      : "italic text-gray-400 dark:text-slate-500"}`}>
      {displayStr ?? placeholder}
    </span>
  );

  const trigger = triggerStyle === "tile" ? (
    <div
      role="button" tabIndex={0}
      onClick={openPicker}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && openPicker()}
      className={[
        "p-3 rounded-lg border cursor-pointer select-none transition-colors",
        isPrimary
          ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/40"
          : "border-[#e5e7eb] dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50",
      ].join(" ")}
    >
      {labelEl}
      <div className="flex items-center justify-between gap-1">
        {valueEl}
        <CalIcon className="flex-none text-gray-400 dark:text-slate-500" />
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={openPicker}
      className={[
        "w-full text-left px-3 py-2.5 rounded-lg border bg-white dark:bg-slate-800",
        "hover:border-[#0b1a33] dark:hover:border-slate-400 transition-colors text-sm",
        "border-gray-300 dark:border-slate-600",
      ].join(" ")}
    >
      {labelEl}
      <div className="flex items-center justify-between gap-2">
        {valueEl}
        <CalIcon className="flex-none text-gray-400 dark:text-slate-500" />
      </div>
    </button>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {trigger}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onMouseDown={e => { if (e.target === e.currentTarget) closePicker(); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 dark:bg-black/70" aria-hidden />

          {/* Sheet / Modal */}
          <div className="relative bg-white dark:bg-slate-800 w-full sm:w-[340px] rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-start justify-between px-5 pt-4 pb-1">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">
                  {modalTitle}
                </h3>
                {rangeHint && (
                  <p className="text-xs text-[#0b1a33] dark:text-blue-300 mt-0.5">
                    {rangeHint}
                  </p>
                )}
              </div>
              <button type="button" onClick={closePicker} aria-label="Close"
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded-full transition-colors mt-0.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Calendar + Time */}
            <div className="px-5 pb-2 pt-3">
              <CalendarGrid
                year={viewYear} month={viewMonth}
                onNav={(y, m) => { setViewYear(y); setViewMonth(m); }}
                mode={mode}
                selected={mode === "single" ? draftDate : undefined}
                onSelect={mode === "single" ? handleDaySelect : undefined}
                rangeFrom={mode === "range" ? draftFrom : undefined}
                rangeTo={mode === "range" ? draftTo : undefined}
                hoverDate={hoverDate}
                onRangeClick={mode === "range" ? handleRangeClick : undefined}
                onHover={setHoverDate}
                minDate={minDate}
                maxDate={maxDate}
              />

              {withTime && mode === "single" && (
                <TimePicker
                  time={draftTime}
                  onChange={setDraftTime}
                  disabled={!draftDate}
                />
              )}

              {err && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-2">⚠ {err}</p>
              )}
            </div>

            {/* Footer — Save / Apply / Cancel */}
            {showFooter && (
              <div className="flex gap-3 px-5 py-4 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700 mt-2">
                <button
                  type="button"
                  onClick={mode === "single" ? handleSave : handleApply}
                  disabled={busy || !canAction}
                  className="btn btn-primary flex-1 justify-center disabled:opacity-50"
                >
                  {busy ? "Saving…" : mode === "range" ? "Apply" : "Save"}
                </button>
                <button type="button" onClick={closePicker}
                  className="btn btn-ghost flex-1 justify-center">
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

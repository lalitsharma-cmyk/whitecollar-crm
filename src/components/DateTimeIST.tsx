"use client";
import { useMemo, useState, useRef, useEffect } from "react";
import { nowISTLocalInput } from "@/lib/datetime";

interface Props {
  /** Current value as IST wall-clock "YYYY-MM-DDTHH:mm". Empty for unset. */
  value: string;
  /** Returns the same shape — "YYYY-MM-DDTHH:mm" or "" */
  onChange: (next: string) => void;
  /** When true, blocks past dates/times (default true for scheduling) */
  futureOnly?: boolean;
  /** Optional id/name for label hookup */
  name?: string;
  className?: string;
  disabled?: boolean;
}

/** Parse 24h "HH:mm" → 12h display values */
function parse12h(t: string): { h: number; m: number; ampm: "AM" | "PM" } {
  if (!t) return { h: 10, m: 0, ampm: "AM" };
  const [hStr = "0", mStr = "0"] = t.split(":");
  const h24 = parseInt(hStr, 10) || 0;
  return {
    h: h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24,
    m: parseInt(mStr, 10) || 0,
    ampm: h24 < 12 ? "AM" : "PM",
  };
}

/** Combine 12h values → "HH:mm" (24h) */
function to24h(h12: number, m: number, ampm: "AM" | "PM"): string {
  const h = Math.max(1, Math.min(12, h12 || 1));
  const mClamped = Math.max(0, Math.min(59, m || 0));
  let h24 = h;
  if (ampm === "AM") {
    if (h24 === 12) h24 = 0;
  } else {
    if (h24 !== 12) h24 += 12;
  }
  return `${String(h24).padStart(2, "0")}:${String(mClamped).padStart(2, "0")}`;
}

/**
 * Date + time picker with explicit AM/PM toggle.
 *
 * Replaces the native <input type="time"> which breaks on Android Chrome —
 * the AM/PM spinner is unreachable once a value is set. This component uses
 * two text inputs (HH / MM) and a tap-friendly AM/PM button instead.
 *
 * Still emits "YYYY-MM-DDTHH:mm" (IST wall-clock) for server compatibility.
 */
export default function DateTimeIST({ value, onChange, futureOnly = true, name, className, disabled }: Props) {
  const [date, time] = value ? value.split("T") : ["", ""];
  const minDate = useMemo(() => (futureOnly ? nowISTLocalInput().split("T")[0] : undefined), [futureOnly]);
  const istToday = nowISTLocalInput().split("T")[0];

  const { h, m, ampm } = parse12h(time);
  const timeDisabled = disabled || !date;

  // Local draft for the minute input — prevents "0" being immediately
  // re-padded to "00" (filling maxLength=2) and blocking the second digit.
  const [minRaw, setMinRaw] = useState(() => String(m).padStart(2, "0"));
  const isMinFocused = useRef(false);
  useEffect(() => {
    if (!isMinFocused.current) setMinRaw(String(m).padStart(2, "0"));
  }, [m]);

  function setDate(d: string) {
    if (!d) { onChange(""); return; }
    onChange(`${d}T${time || "10:00"}`);
  }

  function setHour(v: string) {
    const clean = v.replace(/\D/g, "").slice(0, 2);
    if (!clean) return;
    const n = Math.max(1, Math.min(12, parseInt(clean, 10) || 1));
    onChange(`${date || istToday}T${to24h(n, m, ampm)}`);
  }

  function toggleAmPm() {
    if (timeDisabled) return;
    onChange(`${date}T${to24h(h, m, ampm === "AM" ? "PM" : "AM")}`);
  }

  const inputBase =
    "border border-[#e5e7eb] rounded-lg px-2 py-2.5 text-sm text-center min-h-11 w-14 disabled:bg-gray-100 disabled:text-gray-400";

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {/* ── Date row ──────────────────────────────────────────────────────── */}
      <div>
        <label className="text-[10px] text-gray-500 block mb-0.5">📅 Date (IST)</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          min={minDate}
          disabled={disabled}
          className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11"
        />
      </div>

      {/* ── Time row — HH : MM [AM/PM] ────────────────────────────────────── */}
      <div>
        <label className="text-[10px] text-gray-500 block mb-0.5">⏰ Time (IST)</label>
        <div className="flex items-center gap-1.5">
          {/* Hour — 1-12 */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={String(h)}
            onChange={(e) => setHour(e.target.value)}
            onFocus={(e) => e.target.select()}
            disabled={timeDisabled}
            maxLength={2}
            placeholder="10"
            aria-label="Hour"
            className={inputBase}
          />
          <span className="text-gray-400 font-bold select-none">:</span>
          {/* Minute — 00-59 */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={minRaw}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
              setMinRaw(digits);
              if (digits.length === 2) {
                const n = parseInt(digits, 10);
                if (n >= 0 && n <= 59) onChange(`${date || istToday}T${to24h(h, n, ampm)}`);
              }
            }}
            onFocus={(e) => { isMinFocused.current = true; e.target.select(); }}
            onBlur={() => {
              isMinFocused.current = false;
              const n = Math.min(59, parseInt(minRaw.replace(/\D/g, ""), 10) || 0);
              setMinRaw(String(n).padStart(2, "0"));
              onChange(`${date || istToday}T${to24h(h, n, ampm)}`);
            }}
            disabled={timeDisabled}
            maxLength={2}
            placeholder="00"
            aria-label="Minute"
            className={inputBase}
          />
          {/* AM / PM toggle — explicit button, works on all mobile browsers */}
          <button
            type="button"
            onClick={toggleAmPm}
            disabled={timeDisabled}
            aria-label={`Switch to ${ampm === "AM" ? "PM" : "AM"}`}
            className={`px-3 py-2.5 rounded-lg border text-sm font-semibold min-h-11 min-w-[3.5rem] transition-colors select-none ${
              timeDisabled
                ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                : ampm === "AM"
                ? "bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100 active:bg-blue-200"
                : "bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100 active:bg-amber-200"
            }`}
          >
            {ampm}
          </button>
        </div>
      </div>

      {/* Hidden combined field for form submissions */}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

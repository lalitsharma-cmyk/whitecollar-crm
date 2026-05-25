"use client";
import { useMemo } from "react";
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

/**
 * Side-by-side IST date + time picker.
 *
 * Why: HTML `<input type="datetime-local">` collapses date + time into one
 * control. On many mobile browsers the time portion is hidden behind a swipe
 * gesture — Lalit reported "time anywhere is not clickable, date has date,
 * time also has date only" because the time picker was effectively invisible
 * on his Android.
 *
 * Two visible inputs solve it: agents can clearly see + tap both date AND
 * time. The component still emits the combined "YYYY-MM-DDTHH:mm" string the
 * rest of the app already understands (toISTLocalInput / fromISTLocalInput).
 *
 * IST is implicit — the labels say "IST" and `min` blocks past instants.
 */
export default function DateTimeIST({ value, onChange, futureOnly = true, name, className, disabled }: Props) {
  // Split "YYYY-MM-DDTHH:mm" → ["YYYY-MM-DD", "HH:mm"]
  const [date, time] = value ? value.split("T") : ["", ""];
  const minDate = useMemo(() => (futureOnly ? nowISTLocalInput().split("T")[0] : undefined), [futureOnly]);
  const istToday = nowISTLocalInput().split("T")[0];
  // Min time only matters when the selected date is today (IST)
  const minTime = futureOnly && date === istToday ? nowISTLocalInput().split("T")[1] : undefined;

  function setDate(d: string) {
    // If clearing the date, clear the whole value
    if (!d) { onChange(""); return; }
    onChange(`${d}T${time || "10:00"}`);
  }
  function setTime(t: string) {
    if (!t) { onChange(date ? `${date}T00:00` : ""); return; }
    onChange(`${date || istToday}T${t}`);
  }

  return (
    <div className={`flex flex-col sm:flex-row gap-2 ${className ?? ""}`}>
      <div className="flex-1">
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
      <div className="flex-1">
        <label className="text-[10px] text-gray-500 block mb-0.5">⏰ Time (IST)</label>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          min={minTime}
          disabled={disabled || !date}
          className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11 disabled:bg-gray-100 disabled:text-gray-400"
          placeholder="Pick a date first"
        />
      </div>
      {/* Hidden combined field — when `name` is passed (server-action form usage)
          we emit the combined "YYYY-MM-DDTHH:mm" wall-clock so the server can
          parse it with fromISTLocalInput. The visible date+time inputs are
          unnamed; only this hidden field is submitted with the form. */}
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}

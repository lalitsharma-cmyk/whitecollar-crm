"use client";

/**
 * RemindersCard — matches the LeadRat-style Reminders widget.
 *
 * Dark navy card with:
 *   • Month / Year selectors in the header
 *   • Mon–Sun column labels + 7-day week strip (prev / next week navigation)
 *   • Selected day highlighted with a filled white circle
 *   • Count row: N Site Visits  N Meetings  N Callbacks (colored bars)
 *   • "Today" / "Tomorrow" / date-label section header
 *   • Event rows: left = time (colored) + agent name below;
 *                 right = "Site Visit scheduled with [bold client]"
 */

import { useState, useMemo } from "react";
import Link from "next/link";

export type ReminderType = "SITE_VISIT" | "MEETING" | "CALLBACK";

export interface ReminderEvent {
  id: string;
  leadId: string;
  leadName: string;
  type: ReminderType;
  /** ISO datetime string */
  timeIso: string;
  /** Agent / owner name — non-null on admin/manager view */
  agentName: string | null;
  agentInitials: string | null;
}

interface Props {
  events: ReminderEvent[];
  /** ISO date string for "today" in IST (YYYY-MM-DD) */
  todayIso: string;
  /** Show agent column (admin / manager view) */
  showAgent: boolean;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const TYPE_COLOR: Record<ReminderType, string> = {
  SITE_VISIT: "#22c55e",   // green-500
  MEETING:    "#3b82f6",   // blue-500
  CALLBACK:   "#f59e0b",   // amber-500
};
const TYPE_VERB: Record<ReminderType, string> = {
  SITE_VISIT: "Site Visit scheduled with",
  MEETING:    "Meeting scheduled with",
  CALLBACK:   "Callback due for",
};

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Monday of the week that contains isoDate */
function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay(): 0=Sun, 1=Mon … 6=Sat
  const dow = dt.getUTCDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(isoDate, mondayOffset);
}

function isoToLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  }).toLowerCase(); // "10:00 am"
}

function dateLabel(isoDate: string, todayIso: string): string {
  if (isoDate === todayIso) return "Today";
  if (isoDate === addDays(todayIso, 1)) return "Tomorrow";
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_SHORT[dt.getUTCDay()]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}

export default function RemindersCard({ events, todayIso, showAgent }: Props) {
  // Track the Monday of the currently visible week
  const [weekMonday, setWeekMonday] = useState(() => weekStart(todayIso));
  const [selectedDate, setSelectedDate] = useState(todayIso);

  // Build 7 days of the visible week (Mon → Sun)
  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(weekMonday, i);
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return { iso, dayShort: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i], dayNum: d, month: m, year: y, jsDay: dt.getUTCDay() };
    });
  }, [weekMonday]);

  // Month/Year of the selected date (for header dropdowns)
  const selParts = selectedDate.split("-").map(Number);
  const selMonth = selParts[1] - 1; // 0-indexed
  const selYear  = selParts[0];

  // Group all events by local IST date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ReminderEvent[]>();
    for (const e of events) {
      const d = isoToLocalDate(e.timeIso);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    }
    return map;
  }, [events]);

  // Events for selected day, sorted by time
  const dayEvents = useMemo(() => {
    return (eventsByDate.get(selectedDate) ?? [])
      .slice()
      .sort((a, b) => a.timeIso.localeCompare(b.timeIso));
  }, [eventsByDate, selectedDate]);

  const siteVisitCount = dayEvents.filter(e => e.type === "SITE_VISIT").length;
  const meetingCount   = dayEvents.filter(e => e.type === "MEETING").length;
  const callbackCount  = dayEvents.filter(e => e.type === "CALLBACK").length;

  function prevWeek() { setWeekMonday(w => addDays(w, -7)); }
  function nextWeek() { setWeekMonday(w => addDays(w, 7)); }

  // Jump to month/year — move week to the Monday of the 1st of that month
  function jumpToMonth(month: number, year: number) {
    const firstDay = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    setWeekMonday(weekStart(firstDay));
    setSelectedDate(firstDay);
  }

  const label = dateLabel(selectedDate, todayIso);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "#0b1a33", color: "#fff" }}
    >
      {/* ── Header: title + Month/Year selectors ── */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="font-bold text-sm text-white">Reminders</span>
        <div className="flex gap-2">
          {/* Month dropdown */}
          <select
            value={selMonth}
            onChange={e => jumpToMonth(Number(e.target.value), selYear)}
            className="text-xs rounded-lg px-2 py-1 font-semibold cursor-pointer"
            style={{ background: "#1a2d4d", color: "#94a3b8", border: "1px solid #2d4a6b" }}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i}>{m.slice(0, 3)}</option>
            ))}
          </select>
          {/* Year dropdown */}
          <select
            value={selYear}
            onChange={e => jumpToMonth(selMonth, Number(e.target.value))}
            className="text-xs rounded-lg px-2 py-1 font-semibold cursor-pointer"
            style={{ background: "#1a2d4d", color: "#94a3b8", border: "1px solid #2d4a6b" }}
          >
            {Array.from({ length: 4 }, (_, i) => selYear - 1 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Week navigation + day grid ── */}
      <div className="px-3 pb-2">
        {/* Day-of-week labels */}
        <div className="grid grid-cols-7 mb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => (
            <div key={d} className="text-center text-[10px] font-semibold" style={{ color: "#64748b" }}>
              {d}
            </div>
          ))}
        </div>

        {/* Date tiles */}
        <div className="grid grid-cols-7 gap-0.5">
          {weekDays.map(day => {
            const isSelected = day.iso === selectedDate;
            const isToday    = day.iso === todayIso;
            const hasEvents  = (eventsByDate.get(day.iso)?.length ?? 0) > 0;
            const hasSV  = eventsByDate.get(day.iso)?.some(e => e.type === "SITE_VISIT") ?? false;
            const hasMtg = eventsByDate.get(day.iso)?.some(e => e.type === "MEETING") ?? false;
            const hasCB  = eventsByDate.get(day.iso)?.some(e => e.type === "CALLBACK") ?? false;

            return (
              <button
                key={day.iso}
                type="button"
                onClick={() => setSelectedDate(day.iso)}
                className="flex flex-col items-center py-1 rounded-lg transition-colors"
                style={isSelected ? { background: "#fff" } : isToday ? { background: "#1a2d4d" } : {}}
              >
                <span
                  className="text-sm font-bold leading-tight"
                  style={{ color: isSelected ? "#0b1a33" : isToday ? "#c9a24b" : "#e2e8f0" }}
                >
                  {day.dayNum}
                </span>
                {/* Event dots */}
                <div className="flex gap-px mt-0.5 h-1.5 justify-center">
                  {hasSV  && <span className="w-1 h-1 rounded-full" style={{ background: isSelected ? "#22c55e" : "#22c55e" }} />}
                  {hasMtg && <span className="w-1 h-1 rounded-full" style={{ background: "#3b82f6" }} />}
                  {hasCB  && <span className="w-1 h-1 rounded-full" style={{ background: "#f59e0b" }} />}
                  {!hasEvents && <span className="w-1 h-1 rounded-full opacity-0" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Prev / Next week navigation */}
        <div className="flex justify-between mt-2">
          <button
            type="button"
            onClick={prevWeek}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ color: "#64748b", background: "#1a2d4d" }}
          >
            ‹ Prev
          </button>
          <button
            type="button"
            onClick={nextWeek}
            className="text-[10px] px-2 py-0.5 rounded"
            style={{ color: "#64748b", background: "#1a2d4d" }}
          >
            Next ›
          </button>
        </div>
      </div>

      {/* ── Count summary row ── */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 text-[11px] font-semibold"
        style={{ borderTop: "1px solid #1a2d4d", borderBottom: "1px solid #1a2d4d" }}
      >
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#22c55e" }} />
          <span style={{ color: "#e2e8f0" }}>{String(siteVisitCount).padStart(2, "0")}</span>
          <span style={{ color: "#64748b" }}>Site Visits</span>
        </span>
        <span style={{ color: "#1e3a5f" }}>|</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#3b82f6" }} />
          <span style={{ color: "#e2e8f0" }}>{String(meetingCount).padStart(2, "0")}</span>
          <span style={{ color: "#64748b" }}>Meetings</span>
        </span>
        <span style={{ color: "#1e3a5f" }}>|</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#f59e0b" }} />
          <span style={{ color: "#e2e8f0" }}>{String(callbackCount).padStart(2, "0")}</span>
          <span style={{ color: "#64748b" }}>Callbacks</span>
        </span>
      </div>

      {/* ── Event list ── */}
      <div className="px-0 pb-2" style={{ maxHeight: "340px", overflowY: "auto" }}>
        {dayEvents.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: "#475569" }}>
            Nothing scheduled for {label.toLowerCase()}.
          </div>
        ) : (
          <>
            {/* Section label */}
            <div
              className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest"
              style={{ color: "#475569" }}
            >
              {label}
            </div>

            {dayEvents.map((evt, i) => {
              const color = TYPE_COLOR[evt.type];
              const verb  = TYPE_VERB[evt.type];
              return (
                <Link
                  key={`${evt.id}-${i}`}
                  href={`/leads/${evt.leadId}`}
                  className="flex items-start gap-3 px-4 py-2.5 hover:opacity-80 transition-opacity"
                  style={{ borderTop: i > 0 ? "1px solid #1a2d4d" : undefined }}
                >
                  {/* Left: time + agent name */}
                  <div className="w-16 shrink-0 text-left">
                    <div className="text-[11px] font-bold tabular-nums" style={{ color }}>
                      {fmtTime(evt.timeIso)}
                    </div>
                    {showAgent && evt.agentName && (
                      <div className="text-[10px] mt-0.5 truncate max-w-[64px]" style={{ color: "#94a3b8" }}>
                        {evt.agentName.split(" ")[0]}{" "}
                        {evt.agentName.split(" ")[1]?.[0] ?? ""}
                      </div>
                    )}
                  </div>

                  {/* Right: verb + client name */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] leading-tight" style={{ color: "#94a3b8" }}>
                      {verb}
                    </div>
                    <div className="text-sm font-semibold mt-0.5 truncate" style={{ color: "#e2e8f0" }}>
                      {evt.leadName}
                    </div>
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

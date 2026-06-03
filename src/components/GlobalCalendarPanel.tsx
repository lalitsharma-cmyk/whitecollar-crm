"use client";
// GlobalCalendarPanel — header calendar icon that opens a month-view panel
// showing follow-ups, meetings, site visits, and scheduled callbacks across
// all leads visible to the current user.
//
// Roles:
//   AGENT   → own events only (API enforces this)
//   MANAGER → team events; team filter dropdown shown
//   ADMIN   → all events; team filter shown
//
// Layout:
//   Desktop → dropdown panel slides down from header icon (right side)
//   Mobile  → bottom-sheet slides up full width

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import type { CalendarEvent } from "@/app/api/calendar/events/route";

// ── IST offset ────────────────────────────────────────────────────────────
// All date display is in IST (UTC+5:30).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(date: Date): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function istNow(): Date {
  return toIST(new Date());
}

/** YYYY-MM-DD string in IST for a given UTC Date */
function istDateStr(date: Date): string {
  const d = toIST(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** HH:MM (IST, 12-hour) */
function fmtTime(iso: string): string {
  const d = toIST(new Date(iso));
  let h = d.getUTCHours();
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

// ── Event colour coding ────────────────────────────────────────────────────
const TYPE_COLOR: Record<CalendarEvent["type"], string> = {
  followup:  "bg-blue-500",
  meeting:   "bg-amber-500",
  site_visit: "bg-green-500",
  virtual:   "bg-purple-500",
  callback:  "bg-orange-500",
};
const TYPE_LABEL: Record<CalendarEvent["type"], string> = {
  followup:  "Follow-up",
  meeting:   "Meeting",
  site_visit: "Site Visit",
  virtual:   "Virtual",
  callback:  "Callback",
};

interface Props {
  role: string;
  team: string | null | undefined;
}

export default function GlobalCalendarPanel({ role, team }: Props) {
  const now = istNow();
  const [open, setOpen] = useState(false);
  // Calendar display state
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(null); // YYYY-MM-DD
  // Team filter (admin/manager only)
  const [filterTeam, setFilterTeam] = useState<"" | "Dubai" | "India">("");
  // Fetched events indexed by date string
  const [eventsByDay, setEventsByDay] = useState<Record<string, CalendarEvent[]>>({});
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Fetch events for current month ──────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const firstDay = new Date(Date.UTC(year, month, 1));
      const lastDay  = new Date(Date.UTC(year, month + 1, 0));
      const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const lastD = lastDay.getUTCDate();
      const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastD).padStart(2, "0")}`;

      const url = `/api/calendar/events?from=${from}&to=${to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load calendar events");
      const data: { events: CalendarEvent[] } = await res.json();

      // Index events by IST date string
      const byDay: Record<string, CalendarEvent[]> = {};
      for (const ev of data.events) {
        const d = istDateStr(new Date(ev.date));
        if (!byDay[d]) byDay[d] = [];
        byDay[d].push(ev);
      }
      setEventsByDay(byDay);
    } catch {
      // silently fail — calendar is non-critical
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    if (open) fetchEvents();
  }, [open, fetchEvents]);

  // ── Click-outside to close (desktop only) ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Month navigation ──────────────────────────────────────────────────
  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  // ── Build calendar grid ───────────────────────────────────────────────
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_NAMES = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const startDow = firstOfMonth.getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const todayStr = istDateStr(new Date());

  // Grid cells: leading blanks + days
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full rows
  while (cells.length % 7 !== 0) cells.push(null);

  // ── Selected day events (with optional team filter) ────────────────────
  const selectedEvents = selectedDay
    ? (eventsByDay[selectedDay] ?? []).filter(ev => {
        if (!filterTeam) return true;
        // We don't have team info on the event object — just show all for now
        // (the API already scopes to visible leads)
        return true;
      })
    : [];

  // ── Panel content ─────────────────────────────────────────────────────
  const isManagerOrAdmin = role === "ADMIN" || role === "MANAGER";

  const PanelContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e7eb] dark:border-slate-700">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} aria-label="Previous month" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-semibold text-sm w-36 text-center text-slate-800 dark:text-slate-100">
            {MONTH_NAMES[month]} {year}
          </span>
          <button onClick={nextMonth} aria-label="Next month" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {isManagerOrAdmin && (
            <select
              value={filterTeam}
              onChange={e => setFilterTeam(e.target.value as "" | "Dubai" | "India")}
              className="text-xs border border-slate-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-800 dark:text-slate-200"
            >
              <option value="">All Teams</option>
              <option value="Dubai">Dubai</option>
              <option value="India">India</option>
            </select>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close calendar"
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="px-3 pt-3 pb-2">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES.map(d => (
            <div key={d} className="text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 py-1">
              {d}
            </div>
          ))}
        </div>
        {/* Day cells */}
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`blank-${idx}`} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const dayEvents = eventsByDay[dateStr] ?? [];
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDay;
            // Count by type for dots (max 3 shown)
            const types = [...new Set(dayEvents.map(e => e.type))].slice(0, 3);
            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDay(isSelected ? null : dateStr)}
                className={[
                  "relative flex flex-col items-center pt-1 pb-1.5 rounded-lg text-sm font-medium transition-colors",
                  isToday    ? "bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33]" : "",
                  isSelected && !isToday ? "bg-[#e8f0fe] dark:bg-slate-700 text-[#0b1a33] dark:text-white" : "",
                  !isToday && !isSelected ? "hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200" : "",
                ].filter(Boolean).join(" ")}
              >
                <span className="leading-none">{day}</span>
                {types.length > 0 && (
                  <span className="flex gap-0.5 mt-0.5">
                    {types.map(t => (
                      <span key={t} className={`w-1 h-1 rounded-full ${TYPE_COLOR[t]}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 dark:border-slate-700/50">
        {(Object.keys(TYPE_COLOR) as CalendarEvent["type"][]).map(t => (
          <span key={t} className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            <span className={`w-2 h-2 rounded-full flex-none ${TYPE_COLOR[t]}`} />
            {TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      {/* Selected day event list */}
      {selectedDay && (
        <div className="flex-1 overflow-y-auto border-t border-slate-200 dark:border-slate-700">
          {loading ? (
            <div className="p-4 text-center text-xs text-slate-400">Loading…</div>
          ) : selectedEvents.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">No events on this day</div>
          ) : (
            <ul className="p-3 space-y-2">
              {selectedEvents.map(ev => (
                <li key={ev.id}>
                  <Link
                    href={`/leads/${ev.leadId}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/60 group"
                  >
                    <span className={`mt-1 w-2 h-2 rounded-full flex-none ${TYPE_COLOR[ev.type]}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-100 group-hover:text-[#0b1a33] dark:group-hover:text-[#c9a24b] truncate">
                        {ev.label}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 flex gap-2 flex-wrap mt-0.5">
                        <span>{TYPE_LABEL[ev.type]}</span>
                        <span>· {fmtTime(ev.date)}</span>
                        {ev.assignee && <span>· {ev.assignee}</span>}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  // ── Count of today's events for badge ─────────────────────────────────
  const todayEventCount = (eventsByDay[todayStr] ?? []).length;

  return (
    <div ref={panelRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open calendar"
        className="relative p-2 rounded hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center text-white"
      >
        <Calendar className="w-5 h-5" />
        {todayEventCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[#c9a24b] text-[#0b1a33] text-[9px] font-bold flex items-center justify-center leading-none">
            {todayEventCount > 9 ? "9+" : todayEventCount}
          </span>
        )}
      </button>

      {/* Desktop dropdown panel */}
      {open && (
        <>
          {/* Mobile overlay / bottom-sheet */}
          <div className="sm:hidden fixed inset-0 z-[60] flex flex-col justify-end">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setOpen(false)}
            />
            <div className="relative z-10 bg-white dark:bg-slate-800 rounded-t-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              {PanelContent}
            </div>
          </div>

          {/* Desktop panel */}
          <div className="hidden sm:flex flex-col fixed right-4 top-14 z-[60] w-80 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[80vh] overflow-hidden">
            {PanelContent}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

/**
 * RemindersCard — weekly mini-calendar + daily reminder timeline.
 *
 * Shows a 7-day strip (starting today). Clicking a day tile switches the
 * list below to that day's site visits, meetings, and follow-up callbacks.
 * Each row shows time (IST), agent name (admin/manager view), event type,
 * and client name with a link to the lead detail page.
 *
 * Designed to match the "Reminders" widget spec Lalit shared:
 *   - Week strip at top, selected day highlighted in brand gold
 *   - Count chips: Site Visits | Meetings | Callbacks
 *   - Time-sorted list grouped by "Today" / "Tomorrow" / day label
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

const TYPE_META: Record<ReminderType, { label: string; color: string; dot: string }> = {
  SITE_VISIT: { label: "Site Visit",   color: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  MEETING:    { label: "Meeting",      color: "text-blue-700 dark:text-blue-400",       dot: "bg-blue-500"   },
  CALLBACK:   { label: "Follow-up",    color: "text-amber-700 dark:text-amber-400",     dot: "bg-amber-500"  },
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function dateLabel(isoDate: string, todayIso: string): string {
  if (isoDate === todayIso) return "Today";
  if (isoDate === addDays(todayIso, 1)) return "Tomorrow";
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DAY_SHORT[dt.getUTCDay()]}, ${d} ${MONTH_SHORT[m - 1]}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  }).replace(" am", " am").replace(" pm", " pm").toUpperCase();
}

function isoToLocalDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase();
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-amber-500",
  "bg-rose-500", "bg-teal-500", "bg-indigo-500", "bg-orange-500",
];
function avatarColor(name: string | null): string {
  if (!name) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function RemindersCard({ events, todayIso, showAgent }: Props) {
  const [selectedDate, setSelectedDate] = useState(todayIso);

  // Build 7-day strip starting today
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const iso = addDays(todayIso, i);
      const [y, m, d] = iso.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return {
        iso,
        dayShort: DAY_SHORT[dt.getUTCDay()],
        dayNum: d,
        monthNum: m,
      };
    });
  }, [todayIso]);

  // Group all events by local date (IST)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, ReminderEvent[]>();
    for (const e of events) {
      const d = isoToLocalDate(e.timeIso);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    }
    return map;
  }, [events]);

  // Events for the selected day, sorted by time
  const dayEvents = useMemo(() => {
    return (eventsByDate.get(selectedDate) ?? [])
      .slice()
      .sort((a, b) => a.timeIso.localeCompare(b.timeIso));
  }, [eventsByDate, selectedDate]);

  // Summary counts for selected day
  const siteVisitCount = dayEvents.filter(e => e.type === "SITE_VISIT").length;
  const meetingCount   = dayEvents.filter(e => e.type === "MEETING").length;
  const callbackCount  = dayEvents.filter(e => e.type === "CALLBACK").length;

  const label = dateLabel(selectedDate, todayIso);

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm dark:text-slate-100">🔔 Reminders</div>
        <span className="text-[10px] text-gray-400 dark:text-slate-500">Next 7 days</span>
      </div>

      {/* Week strip */}
      <div className="grid grid-cols-7 gap-1 mb-3">
        {days.map((day) => {
          const evts = eventsByDate.get(day.iso) ?? [];
          const isSelected = day.iso === selectedDate;
          const isToday = day.iso === todayIso;
          // dots: up to 3 colored pips for event types present
          const hasSV  = evts.some(e => e.type === "SITE_VISIT");
          const hasMtg = evts.some(e => e.type === "MEETING");
          const hasCB  = evts.some(e => e.type === "CALLBACK");

          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => setSelectedDate(day.iso)}
              className={`flex flex-col items-center rounded-lg py-1.5 px-0.5 transition-colors ${
                isSelected
                  ? "bg-[#c9a24b] text-white shadow"
                  : isToday
                  ? "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700"
                  : "hover:bg-gray-100 dark:hover:bg-slate-700"
              }`}
            >
              <span className={`text-[9px] font-semibold uppercase tracking-wide ${
                isSelected ? "text-white" : "text-gray-400 dark:text-slate-500"
              }`}>
                {day.dayShort}
              </span>
              <span className={`text-sm font-bold leading-tight ${
                isSelected ? "text-white" : isToday ? "text-[#c9a24b]" : "text-gray-700 dark:text-slate-200"
              }`}>
                {day.dayNum}
              </span>
              {/* Event dots */}
              <div className="flex gap-0.5 mt-0.5 h-1.5">
                {hasSV  && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/80" : "bg-emerald-500"}`} />}
                {hasMtg && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/80" : "bg-blue-500"}`} />}
                {hasCB  && <span className={`w-1 h-1 rounded-full ${isSelected ? "bg-white/80" : "bg-amber-500"}`} />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Count chips for selected day */}
      <div className="flex gap-2 flex-wrap mb-3">
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          siteVisitCount > 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
          {siteVisitCount} Site Visit{siteVisitCount !== 1 ? "s" : ""}
        </span>
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          meetingCount > 0 ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" : "bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
          {meetingCount} Meeting{meetingCount !== 1 ? "s" : ""}
        </span>
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          callbackCount > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" : "bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-500"
        }`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
          {callbackCount} Callback{callbackCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Event list */}
      <div>
        {dayEvents.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-slate-500 py-3 text-center">
            Nothing scheduled for {label.toLowerCase()}.
          </div>
        ) : (
          <>
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-2">
              {label}
            </div>
            <div className="space-y-0">
              {dayEvents.map((evt, i) => {
                const meta = TYPE_META[evt.type];
                const ag = evt.agentName;
                return (
                  <Link
                    key={`${evt.id}-${i}`}
                    href={`/leads/${evt.leadId}`}
                    className="flex items-center gap-2 py-2 border-b border-gray-100 dark:border-slate-800 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/50 rounded px-1 -mx-1 transition-colors"
                  >
                    {/* Time */}
                    <span className="text-[10px] font-mono font-semibold text-gray-500 dark:text-slate-400 w-16 shrink-0 tabular-nums">
                      {fmtTime(evt.timeIso)}
                    </span>

                    {/* Agent avatar — only in admin/manager view */}
                    {showAgent && ag && (
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${avatarColor(ag)}`}
                        title={ag}
                      >
                        {initials(ag)}
                      </span>
                    )}

                    {/* Type dot */}
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs leading-tight truncate">
                        {showAgent && ag ? (
                          <span className="font-semibold text-gray-700 dark:text-slate-200">{ag.split(" ")[0]} · </span>
                        ) : null}
                        <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                        <span className="text-gray-400 dark:text-slate-500"> with </span>
                        <span className="font-semibold text-gray-800 dark:text-slate-100">{evt.leadName}</span>
                      </div>
                    </div>

                    {/* Arrow */}
                    <span className="text-gray-300 dark:text-slate-600 text-xs shrink-0">›</span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

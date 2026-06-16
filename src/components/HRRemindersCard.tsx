"use client";
// HR reminders panel — same navy calendar style as the Sales RemindersCard,
// but for recruitment events (interviews, confirmations, follow-ups, offers)
// and linking to /hr/candidates/[id].
import { useState, useMemo } from "react";
import Link from "next/link";

export type HREventType = "INTERVIEW" | "CONFIRM" | "FOLLOWUP" | "OFFER";

export interface HRReminderEvent {
  id: string;
  candidateId: string;
  candidateName: string;
  type: HREventType;
  label: string;        // specific action, e.g. "Call", "Confirm Interview", "Offer Discussion"
  timeIso: string;
  ownerName: string | null;
}

interface Props {
  events: HRReminderEvent[];
  todayIso: string;     // YYYY-MM-DD (IST)
  showOwner: boolean;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const TYPE_COLOR: Record<HREventType, string> = {
  INTERVIEW: "#3b82f6", CONFIRM: "#f59e0b", FOLLOWUP: "#22c55e", OFFER: "#a855f7",
};

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(isoDate, dow === 0 ? -6 : 1 - dow);
}
function isoToLocalDate(iso: string): string { return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); }
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).toLowerCase();
}
function isDateOnly(iso: string): boolean { const d = new Date(iso); return d.getUTCHours() === 0 && d.getUTCMinutes() === 0; }
function dateLabel(isoDate: string, todayIso: string): string {
  if (isoDate === todayIso) return "Today";
  if (isoDate === addDays(todayIso, 1)) return "Tomorrow";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${DAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS_SHORT[m - 1]}`;
}

export default function HRRemindersCard({ events, todayIso, showOwner }: Props) {
  const [weekMonday, setWeekMonday] = useState(() => weekStart(todayIso));
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(weekMonday, i);
    return { iso, dayNum: Number(iso.split("-")[2]) };
  }), [weekMonday]);

  const selParts = selectedDate.split("-").map(Number);
  const selMonth = selParts[1] - 1, selYear = selParts[0];

  const eventsByDate = useMemo(() => {
    const map = new Map<string, HRReminderEvent[]>();
    for (const e of events) {
      const d = isoToLocalDate(e.timeIso);
      if (!map.has(d)) map.set(d, []);
      map.get(d)!.push(e);
    }
    return map;
  }, [events]);

  const dayEvents = useMemo(() => (eventsByDate.get(selectedDate) ?? []).slice().sort((a, b) => a.timeIso.localeCompare(b.timeIso)), [eventsByDate, selectedDate]);
  const ivCount = dayEvents.filter(e => e.type === "INTERVIEW").length;
  const cfCount = dayEvents.filter(e => e.type === "CONFIRM").length;
  const fuCount = dayEvents.filter(e => e.type === "FOLLOWUP" || e.type === "OFFER").length;

  function jumpToMonth(month: number, year: number) {
    const first = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    setWeekMonday(weekStart(first)); setSelectedDate(first);
  }
  const label = dateLabel(selectedDate, todayIso);

  return (
    <div className="rounded-2xl flex flex-col" style={{ background: "#0b1a33", color: "#fff", maxHeight: "calc(100dvh - 2rem)" }}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="font-bold text-sm text-white">Today&apos;s Reminders</span>
        <div className="flex gap-2">
          <select value={selMonth} onChange={e => jumpToMonth(Number(e.target.value), selYear)} className="text-xs rounded-lg px-2 py-1 font-semibold cursor-pointer" style={{ background: "#1a2d4d", color: "#94a3b8", border: "1px solid #2d4a6b" }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m.slice(0, 3)}</option>)}
          </select>
          <select value={selYear} onChange={e => jumpToMonth(selMonth, Number(e.target.value))} className="text-xs rounded-lg px-2 py-1 font-semibold cursor-pointer" style={{ background: "#1a2d4d", color: "#94a3b8", border: "1px solid #2d4a6b" }}>
            {Array.from({ length: 4 }, (_, i) => selYear - 1 + i).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="grid grid-cols-7 mb-1">
          {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => <div key={d} className="text-center text-[10px] font-semibold" style={{ color: "#64748b" }}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {weekDays.map(day => {
            const isSelected = day.iso === selectedDate, isToday = day.iso === todayIso;
            const evs = eventsByDate.get(day.iso) ?? [];
            return (
              <button key={day.iso} type="button" onClick={() => setSelectedDate(day.iso)} className="flex flex-col items-center py-1 rounded-lg transition-colors"
                style={isSelected ? { background: "#fff" } : isToday ? { background: "#1a2d4d" } : {}}>
                <span className="text-sm font-bold leading-tight" style={{ color: isSelected ? "#0b1a33" : isToday ? "#c9a24b" : "#e2e8f0" }}>{day.dayNum}</span>
                <div className="flex gap-px mt-0.5 h-1.5 justify-center">
                  {evs.some(e => e.type === "INTERVIEW") && <span className="w-1 h-1 rounded-full" style={{ background: "#3b82f6" }} />}
                  {evs.some(e => e.type === "CONFIRM") && <span className="w-1 h-1 rounded-full" style={{ background: "#f59e0b" }} />}
                  {evs.some(e => e.type === "FOLLOWUP" || e.type === "OFFER") && <span className="w-1 h-1 rounded-full" style={{ background: "#22c55e" }} />}
                  {evs.length === 0 && <span className="w-1 h-1 rounded-full opacity-0" />}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex justify-between mt-2">
          <button type="button" onClick={() => setWeekMonday(w => addDays(w, -7))} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "#64748b", background: "#1a2d4d" }}>‹ Prev</button>
          <button type="button" onClick={() => setWeekMonday(w => addDays(w, 7))} className="text-[10px] px-2 py-0.5 rounded" style={{ color: "#64748b", background: "#1a2d4d" }}>Next ›</button>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-2.5 text-[11px] font-semibold" style={{ borderTop: "1px solid #1a2d4d", borderBottom: "1px solid #1a2d4d" }}>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#3b82f6" }} /><span style={{ color: "#e2e8f0" }}>{String(ivCount).padStart(2, "0")}</span><span style={{ color: "#64748b" }}>Interviews</span></span>
        <span style={{ color: "#1e3a5f" }}>|</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#f59e0b" }} /><span style={{ color: "#e2e8f0" }}>{String(cfCount).padStart(2, "0")}</span><span style={{ color: "#64748b" }}>Confirm</span></span>
        <span style={{ color: "#1e3a5f" }}>|</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] inline-block" style={{ background: "#22c55e" }} /><span style={{ color: "#e2e8f0" }}>{String(fuCount).padStart(2, "0")}</span><span style={{ color: "#64748b" }}>Follow-ups</span></span>
      </div>

      <div className="px-0 pb-2 flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin", scrollbarColor: "#2d4a6b #0b1a33" }}>
        {dayEvents.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: "#475569" }}>Nothing scheduled for {label.toLowerCase()}.</div>
        ) : (
          <>
            <div className="px-4 py-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: "#475569" }}>{label}</div>
            {dayEvents.map((evt, i) => {
              const color = TYPE_COLOR[evt.type];
              return (
                <Link key={`${evt.id}-${i}`} href={`/hr/candidates/${evt.candidateId}`} className="block px-4 py-2.5 hover:opacity-80 transition-opacity" style={{ borderTop: i > 0 ? "1px solid #1a2d4d" : undefined }}>
                  {!isDateOnly(evt.timeIso) && <div className="text-[12px] font-bold tabular-nums" style={{ color }}>{fmtTime(evt.timeIso)}</div>}
                  <div className="text-sm font-semibold leading-snug break-words" style={{ color: "#e2e8f0" }}>{evt.candidateName}</div>
                  <div className="text-[11px] leading-tight mt-0.5 break-words" style={{ color }}>
                    {evt.label}{showOwner && evt.ownerName && <span style={{ color: "#94a3b8" }}> · {evt.ownerName.split(" ")[0]}</span>}
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

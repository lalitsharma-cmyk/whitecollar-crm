import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function startOfDay(d: Date) { const r = new Date(d); r.setHours(0,0,0,0); return r; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function fmtDateShort(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const TYPE_COLOR: Record<string, string> = {
  VIRTUAL:      "bg-indigo-100 text-indigo-700 border-indigo-300",
  HR:           "bg-cyan-100 text-cyan-700 border-cyan-300",
  FINAL:        "bg-purple-100 text-purple-700 border-purple-300",
  FACE_TO_FACE: "bg-blue-100 text-blue-700 border-blue-300",
  FOLLOWUP:     "bg-amber-100 text-amber-700 border-amber-300",
};

function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

export default async function CalendarPage() {
  const { me } = await requireHrPage();

  const today = startOfDay(new Date());
  const next14End = addDays(today, 14);

  // Fetch interviews + follow-ups for the next 14 days
  const [interviews, followUps] = await Promise.all([
    prisma.hRInterview.findMany({
      where: {
        scheduledAt: { gte: today, lt: next14End },
        attendanceStatus: { in: ["SCHEDULED", "RESCHEDULED"] },
        candidate: hrScopeWhere(me),
      },
      orderBy: { scheduledAt: "asc" },
      include: {
        candidate: { select: { id: true, name: true, phone: true } },
        interviewer: { select: { name: true } },
      },
    }),
    prisma.hRFollowUp.findMany({
      where: {
        dueAt: { gte: today, lt: next14End },
        completedAt: null,
        candidate: hrScopeWhere(me),
      },
      orderBy: { dueAt: "asc" },
      include: {
        candidate: { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);

  // Build day-by-day calendar (next 14 days)
  const days: Array<{
    date: Date;
    label: string;
    isToday: boolean;
    events: Array<{ id: string; time: Date; title: string; subtitle: string; href: string; colorClass: string; kind: "interview" | "followup" }>;
  }> = [];

  for (let i = 0; i < 14; i++) {
    const day = addDays(today, i);
    const dayEnd = addDays(day, 1);

    const dayInterviews = interviews.filter(iv =>
      iv.scheduledAt >= day && iv.scheduledAt < dayEnd
    ).map(iv => ({
      id: iv.id,
      time: iv.scheduledAt,
      title: `🎯 ${fmt(iv.type)} — ${iv.candidate.name}`,
      subtitle: `${fmtTime(iv.scheduledAt)}${iv.interviewer ? ` · ${iv.interviewer.name}` : ""}`,
      href: `/hr/candidates/${iv.candidateId}`,
      colorClass: TYPE_COLOR[iv.type] ?? "bg-gray-100 text-gray-700 border-gray-300",
      kind: "interview" as const,
    }));

    const dayFollowUps = followUps.filter(fu =>
      fu.dueAt >= day && fu.dueAt < dayEnd
    ).map(fu => ({
      id: fu.id,
      time: fu.dueAt,
      title: `📅 ${fmt(fu.type)} — ${fu.candidate.name}`,
      subtitle: `${fmtTime(fu.dueAt)}${fu.candidate.phone ? ` · ${fu.candidate.phone}` : ""}`,
      href: `/hr/candidates/${fu.candidateId}`,
      colorClass: TYPE_COLOR.FOLLOWUP,
      kind: "followup" as const,
    }));

    const events = [...dayInterviews, ...dayFollowUps]
      .sort((a, b) => a.time.getTime() - b.time.getTime());

    days.push({
      date: day,
      label: fmtDate(day),
      isToday: i === 0,
      events,
    });
  }

  const totalEvents = days.reduce((sum, d) => sum + d.events.length, 0);
  const todayEvents = days[0]?.events ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Calendar</h1>
          <p className="text-sm text-gray-500">Interviews & follow-ups — next 14 days · {totalEvents} events</p>
        </div>
        <div className="flex gap-2 text-xs flex-wrap">
          <span className="px-2 py-1 rounded-lg border bg-indigo-50 text-indigo-700 border-indigo-200">🎯 Interview</span>
          <span className="px-2 py-1 rounded-lg border bg-amber-50 text-amber-700 border-amber-200">📅 Follow-Up</span>
        </div>
      </div>

      {/* Today highlighted */}
      {todayEvents.length > 0 && (
        <div className="bg-[#1a2e4a] text-white rounded-2xl p-4">
          <div className="text-sm font-bold mb-3">📅 Today — {fmtDateShort(today)}</div>
          <div className="space-y-2">
            {todayEvents.map(ev => (
              <Link key={ev.id} href={ev.href}
                className="flex items-start gap-3 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2.5 transition">
                <div className="text-xs font-bold text-white/70 w-14 shrink-0 pt-0.5">{fmtTime(ev.time)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{ev.title}</div>
                  <div className="text-[11px] text-white/60 mt-0.5">{ev.subtitle}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {todayEvents.length === 0 && (
        <div className="bg-[#1a2e4a] text-white rounded-2xl p-4 text-center">
          <div className="text-sm font-bold mb-1">📅 Today — {fmtDateShort(today)}</div>
          <div className="text-white/50 text-xs">Nothing scheduled for today.</div>
        </div>
      )}

      {/* Remaining days */}
      <div className="space-y-4">
        {days.slice(1).filter(d => d.events.length > 0).map(day => (
          <div key={day.date.toISOString()} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            {/* Day header */}
            <div className="px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{day.label}</span>
              <span className="text-xs text-gray-400">{day.events.length} event{day.events.length !== 1 ? "s" : ""}</span>
            </div>
            {/* Events */}
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {day.events.map(ev => (
                <Link key={ev.id} href={ev.href}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition">
                  <div className="text-xs font-semibold text-gray-500 w-14 shrink-0 pt-0.5">{fmtTime(ev.time)}</div>
                  <div className={`text-[10px] px-2 py-0.5 rounded border font-medium self-start shrink-0 ${ev.colorClass}`}>
                    {ev.kind === "interview" ? "Interview" : "Follow-Up"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 dark:text-slate-100 truncate">{ev.title}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{ev.subtitle}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {days.slice(1).every(d => d.events.length === 0) && (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">🗓️</div>
            <div className="text-sm">No events in the next 14 days.</div>
            <Link href="/hr/candidates" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
              Schedule an interview →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

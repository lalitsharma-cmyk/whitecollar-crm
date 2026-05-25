import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { format, subDays } from "date-fns";
import { todayIST } from "@/lib/attendance";
import AttendanceCellEditor from "@/components/AttendanceCellEditor";

export const dynamic = "force-dynamic";

const STATUS_VIEW: Record<string, { emoji: string; cls: string }> = {
  PRESENT:  { emoji: "✅", cls: "bg-emerald-100 text-emerald-800" },
  LATE:     { emoji: "🕓", cls: "bg-amber-100 text-amber-800" },
  ABSENT:   { emoji: "❌", cls: "bg-red-100 text-red-800" },
  ON_LEAVE: { emoji: "🌴", cls: "bg-blue-100 text-blue-800" },
};

export default async function AttendancePage() {
  await requireRole("ADMIN");

  // 14 days × every active agent — grid view
  const today = todayIST();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today.getTime() - (13 - i) * 86400000);
    return d;
  });

  const [agents, rows] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
    prisma.attendance.findMany({ where: { date: { gte: days[0] } } }),
  ]);

  // index: userId → date(YYYY-MM-DD) → row
  const idx = new Map<string, Map<string, typeof rows[number]>>();
  for (const r of rows) {
    if (!idx.has(r.userId)) idx.set(r.userId, new Map());
    idx.get(r.userId)!.set(format(r.date, "yyyy-MM-dd"), r);
  }

  // Today's counts
  const todayKey = format(today, "yyyy-MM-dd");
  const todayCounts = { PRESENT: 0, LATE: 0, ABSENT: 0, ON_LEAVE: 0, MISSING: 0 } as Record<string, number>;
  for (const a of agents) {
    const r = idx.get(a.id)?.get(todayKey);
    if (!r) todayCounts.MISSING++;
    else todayCounts[r.status]++;
  }

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🗓 Attendance</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Auto-marked on login (PRESENT before 10:30am IST, LATE after). Only PRESENT/LATE agents get new round-robin leads.
          Click any cell to override.
        </p>
      </div>

      {/* Today snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Present" value={todayCounts.PRESENT} cls="bg-emerald-50 text-emerald-800" />
        <Stat label="Late"    value={todayCounts.LATE}    cls="bg-amber-50 text-amber-800" />
        <Stat label="Absent"  value={todayCounts.ABSENT}  cls="bg-red-50 text-red-800" />
        <Stat label="On leave" value={todayCounts.ON_LEAVE} cls="bg-blue-50 text-blue-800" />
        <Stat label="Not yet marked" value={todayCounts.MISSING} cls="bg-gray-50 text-gray-600" />
      </div>

      {/* 14-day grid */}
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 text-left">Agent</th>
              {days.map((d) => (
                <th key={d.toISOString()} className="text-center text-[10px]">{format(d, "d MMM")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id}>
                <td className="sticky left-0 bg-white z-10 font-semibold text-sm">
                  {a.name}
                  <div className="text-[10px] text-gray-500">{a.team ?? "—"}</div>
                </td>
                {days.map((d) => {
                  const dayKey = format(d, "yyyy-MM-dd");
                  const r = idx.get(a.id)?.get(dayKey);
                  return (
                    <td key={d.toISOString()} className="text-center">
                      <AttendanceCellEditor userId={a.id} date={dayKey} current={r?.status ?? null} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`card p-3 text-center ${cls}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-widest">{label}</div>
    </div>
  );
}

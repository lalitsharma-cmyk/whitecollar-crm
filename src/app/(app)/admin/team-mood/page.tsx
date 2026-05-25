import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { format, subDays, startOfDay } from "date-fns";

export const dynamic = "force-dynamic";

const EMOJI: Record<string, { emoji: string; label: string; cls: string }> = {
  FRUSTRATING: { emoji: "😣", label: "Really frustrating", cls: "bg-red-50 text-red-700" },
  NOT_GREAT:   { emoji: "🙁", label: "Not great",         cls: "bg-amber-50 text-amber-700" },
  MIXED:       { emoji: "😐", label: "Mixed",             cls: "bg-gray-50 text-gray-700" },
  LOOKS_GOOD:  { emoji: "🙂", label: "Looks good",        cls: "bg-blue-50 text-blue-700" },
  AWESOME:     { emoji: "😍", label: "Awesome",           cls: "bg-emerald-50 text-emerald-700" },
};
const ORDER = ["FRUSTRATING", "NOT_GREAT", "MIXED", "LOOKS_GOOD", "AWESOME"];

export default async function TeamMoodPage() {
  await requireRole("ADMIN");

  // Last 14 days × every active agent — sparse grid (blank cells = no check-in)
  const today = startOfDay(new Date());
  const days = Array.from({ length: 14 }, (_, i) => subDays(today, 13 - i));
  const firstDay = days[0];

  const [agents, moodsRaw] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
    prisma.dailyMood.findMany({ where: { date: { gte: firstDay } } }),
  ]);
  // Manual join — DailyMood doesn't declare a Prisma relation to User
  const userById = new Map(agents.map((u) => [u.id, u]));
  const moods = moodsRaw.map((m) => ({ ...m, user: userById.get(m.userId) ?? { name: "Unknown", team: null } }));

  // index by userId → date(YYYY-MM-DD) → mood row
  const idx = new Map<string, Map<string, typeof moods[number]>>();
  for (const m of moods) {
    if (!idx.has(m.userId)) idx.set(m.userId, new Map());
    idx.get(m.userId)!.set(format(m.date, "yyyy-MM-dd"), m);
  }

  // Today's at-a-glance: how many AWESOME/LOOKS_GOOD/FRUSTRATING etc.
  const todayKey = format(today, "yyyy-MM-dd");
  const todayCounts = { FRUSTRATING: 0, NOT_GREAT: 0, MIXED: 0, LOOKS_GOOD: 0, AWESOME: 0 } as Record<string, number>;
  let todayResponded = 0;
  for (const a of agents) {
    const m = idx.get(a.id)?.get(todayKey);
    if (m) { todayCounts[m.mood]++; todayResponded++; }
  }

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">😊 Team Mood</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Optional end-of-day check-ins from the team. Helps spot burnout early.
          Last 14 days · {todayResponded} / {agents.length} responded today.
        </p>
      </div>

      {/* Today's snapshot */}
      <div className="grid grid-cols-5 gap-2">
        {ORDER.map((k) => {
          const e = EMOJI[k];
          return (
            <div key={k} className={`card p-3 text-center ${e.cls}`}>
              <div className="text-2xl">{e.emoji}</div>
              <div className="text-2xl font-bold mt-1">{todayCounts[k]}</div>
              <div className="text-[10px] uppercase tracking-widest">{e.label}</div>
            </div>
          );
        })}
      </div>

      {/* 14-day mood grid */}
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
            {agents.map((a) => {
              const inner = idx.get(a.id);
              return (
                <tr key={a.id}>
                  <td className="sticky left-0 bg-white z-10 font-semibold text-sm">
                    {a.name}
                    <div className="text-[10px] text-gray-500">{a.team ?? "—"}</div>
                  </td>
                  {days.map((d) => {
                    const m = inner?.get(format(d, "yyyy-MM-dd"));
                    return (
                      <td key={d.toISOString()} className="text-center" title={m?.comment ?? ""}>
                        {m ? (
                          <span className="text-xl" title={`${EMOJI[m.mood].label}${m.comment ? " — " + m.comment : ""}`}>
                            {EMOJI[m.mood].emoji}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent comments (last 7 days, latest first) */}
      <div className="card p-4">
        <div className="font-semibold mb-3">Recent comments (last 7 days)</div>
        <div className="space-y-2">
          {moods
            .filter((m) => m.comment && m.date >= subDays(today, 6))
            .sort((a, b) => b.date.getTime() - a.date.getTime())
            .slice(0, 20)
            .map((m) => (
              <div key={m.id} className="border-l-2 border-[#e5e7eb] pl-3 py-1">
                <div className="text-[11px] text-gray-500">
                  <b>{m.user.name}</b> · {format(m.date, "d MMM")} · {EMOJI[m.mood].emoji} {EMOJI[m.mood].label}
                </div>
                <div className="text-sm text-gray-800 italic">"{m.comment}"</div>
              </div>
            ))}
          {moods.filter((m) => m.comment && m.date >= subDays(today, 6)).length === 0 && (
            <div className="text-xs text-gray-500">No comments in the last 7 days.</div>
          )}
        </div>
      </div>
    </>
  );
}

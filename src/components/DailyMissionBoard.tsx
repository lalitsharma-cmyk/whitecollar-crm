import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { startOfDay } from "date-fns";

// §11.5 Daily Missions board — agent-facing gamified daily targets.
//
// Renders a card with 4 mission rows (calls / follow-ups / cold-conversions /
// meetings), each with a progress bar, X/Y count, and XP reward chip. All
// counts are scoped to the requesting agent and to "today" (IST midnight,
// matching the rest of the dashboard which uses startOfDay(new Date())).
//
// Server component — awaits Prisma directly so it streams in with the rest of
// the dashboard. Mounted from `(app)/dashboard/page.tsx` immediately after the
// Daily Opening Experience card. Do not refactor to a client component without
// solving the round-trip for the per-agent counts.

interface Mission {
  emoji: string;
  label: string;
  count: number;
  target: number;
  xp: number;
}

export default async function DailyMissionBoard({ userId }: { userId: string }) {
  const todayStart = startOfDay(new Date());

  const [callsCount, followupsCount, coldConvCount, meetingsCount] = await Promise.all([
    prisma.callLog.count({
      where: { userId, startedAt: { gte: todayStart } },
    }),
    prisma.activity.count({
      where: {
        userId,
        type: ActivityType.TASK,
        status: ActivityStatus.DONE,
        completedAt: { gte: todayStart },
        title: { contains: "Action List" },
      },
    }),
    prisma.activity.count({
      where: {
        userId,
        type: ActivityType.COLD_TO_LEAD,
        completedAt: { gte: todayStart },
      },
    }),
    prisma.activity.count({
      where: {
        userId,
        type: { in: [ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING] },
        createdAt: { gte: todayStart },
      },
    }),
  ]);

  const missions: Mission[] = [
    { emoji: "📞", label: "Make 30 calls today", count: callsCount, target: 30, xp: 30 },
    { emoji: "✅", label: "Complete 5 follow-ups today", count: followupsCount, target: 5, xp: 50 },
    { emoji: "🧊", label: "Convert 2 cold leads", count: coldConvCount, target: 2, xp: 100 },
    { emoji: "🤝", label: "Book 1 meeting", count: meetingsCount, target: 1, xp: 75 },
  ];

  return (
    <div className="card p-4 border-l-4 border-[#c9a24b] bg-amber-50/60">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-base sm:text-lg font-bold text-[#0b1a33]">🎯 Today&apos;s missions</h2>
        <span className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
          Daily targets
        </span>
      </div>
      <div className="space-y-3">
        {missions.map((m) => (
          <MissionRow key={m.label} mission={m} />
        ))}
      </div>
    </div>
  );
}

function MissionRow({ mission }: { mission: Mission }) {
  const { emoji, label, count, target, xp } = mission;
  const done = count >= target;
  const empty = count === 0;
  const pct = Math.min(100, (count / target) * 100);

  return (
    <div className="rounded-xl border border-[#c9a24b]/40 bg-white px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-lg flex-none">{emoji}</span>
          <span
            className={`text-sm font-semibold truncate ${
              done ? "text-emerald-700" : empty ? "text-gray-400" : "text-[#0b1a33]"
            }`}
          >
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {done ? (
            <span className="text-[11px] font-bold text-emerald-700 flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-600 text-white text-[9px]">
                ✓
              </span>
              Done!
            </span>
          ) : (
            <span
              className={`text-xs font-bold tabular-nums ${
                empty ? "text-gray-400" : "text-[#0b1a33]"
              }`}
            >
              {count} / {target}
            </span>
          )}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            +{xp} XP
          </span>
        </div>
      </div>
      <div
        className="mt-2 h-2 w-full rounded-full overflow-hidden"
        style={{ background: "rgba(201, 162, 75, 0.12)" }}
        role="progressbar"
        aria-valuenow={count}
        aria-valuemin={0}
        aria-valuemax={target}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: done
              ? "linear-gradient(90deg, #10b981, #34d399)"
              : "linear-gradient(90deg, #c9a24b, #e7c97a)",
          }}
        />
      </div>
    </div>
  );
}

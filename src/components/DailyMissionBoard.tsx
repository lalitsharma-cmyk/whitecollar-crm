import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, CallOutcome, LeadStatus } from "@prisma/client";
import { startOfDay } from "date-fns";
import MissionCompleteBeacon from "@/components/MissionCompleteBeacon";

// Daily Missions board — agent-facing gamified daily targets.
// Targets aligned to team daily mission:
//   Team: 150 calls / 50 connects / 2 VM / 1 F2F / 5 cold / 5 deals / 10M AED
//   Per-agent (÷5 agents): 30 / 10 / 2 / 1 / 1 / 1
//
// Server component — awaits Prisma directly so it streams in with the rest of
// the dashboard. Mounted from `(app)/dashboard/page.tsx`.

interface Mission {
  emoji: string;
  label: string;
  count: number;
  target: number;
  xp: number;
  tooltip?: string;
  unit?: string;
}

export default async function DailyMissionBoard({ userId }: { userId: string }) {
  const todayStart = startOfDay(new Date());

  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyCallTarget: true, dailyConnectTarget: true },
  });
  const callTarget    = u?.dailyCallTarget    ?? 30;
  const connectTarget = u?.dailyConnectTarget ?? 10;

  const [
    callsCount,
    connectingCount,
    virtualMeetingsCount,
    f2fMeetingsCount,
    coldConvCount,
    dealsCount,
  ] = await Promise.all([
    // Total calls dialled today
    prisma.callLog.count({
      where: { userId, startedAt: { gte: todayStart } },
    }),
    // Calls that connected (CONNECTED or INTERESTED outcome)
    prisma.callLog.count({
      where: {
        userId,
        startedAt: { gte: todayStart },
        outcome: { in: [CallOutcome.CONNECTED, CallOutcome.INTERESTED] },
      },
    }),
    // Virtual meetings booked/done today
    prisma.activity.count({
      where: {
        userId,
        type: ActivityType.VIRTUAL_MEETING,
        createdAt: { gte: todayStart },
      },
    }),
    // F2F meetings (office, site visit, home visit, expo) booked/done today
    prisma.activity.count({
      where: {
        userId,
        type: {
          in: [
            ActivityType.OFFICE_MEETING,
            ActivityType.SITE_VISIT,
            ActivityType.HOME_VISIT,
            ActivityType.EXPO_MEETING,
          ],
        },
        createdAt: { gte: todayStart },
      },
    }),
    // Fresh clients — cold-to-lead conversions today
    prisma.activity.count({
      where: {
        userId,
        type: ActivityType.COLD_TO_LEAD,
        completedAt: { gte: todayStart },
      },
    }),
    // Deals closed (WON) today
    prisma.lead.count({
      where: {
        ownerId: userId,
        status: LeadStatus.WON,
        updatedAt: { gte: todayStart },
      },
    }),
  ]);

  const missions: Mission[] = [
    {
      emoji: "📞",
      label: `Make ${callTarget} calls`,
      count: callsCount,
      target: callTarget,
      xp: 30,
      tooltip: "Total dials logged in the system today.",
    },
    {
      emoji: "🔗",
      label: `Connect with ${connectTarget} leads`,
      count: connectingCount,
      target: connectTarget,
      xp: 40,
      tooltip: "Calls where the client actually picked up (Connected or Interested outcome).",
    },
    {
      emoji: "💻",
      label: "Book 2 virtual meetings",
      count: virtualMeetingsCount,
      target: 2,
      xp: 60,
      tooltip: "Virtual meetings created or completed today.",
    },
    {
      emoji: "🤝",
      label: "Book 1 F2F meeting",
      count: f2fMeetingsCount,
      target: 1,
      xp: 75,
      tooltip: "Office meetings, site visits, home visits, or expo meetings created today.",
    },
    {
      emoji: "🧊",
      label: "Convert 1 fresh client",
      count: coldConvCount,
      target: 1,
      xp: 100,
      tooltip: "Cold calls that you converted into a new active lead today.",
    },
    {
      emoji: "🏆",
      label: "Close 1 deal",
      count: dealsCount,
      target: 1,
      xp: 200,
      tooltip: "Leads marked WON today.",
    },
  ];

  const allDone = missions.every((m) => m.count >= m.target);
  const completedCount = missions.filter((m) => m.count >= m.target).length;
  const totalXp = missions
    .filter((m) => m.count >= m.target)
    .reduce((s, m) => s + m.xp, 0);

  return (
    <div className="card p-4 border-l-4 border-[#c9a24b] bg-amber-50/60">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-base sm:text-lg font-bold text-[#0b1a33]">🎯 Today&apos;s missions</h2>
        <div className="flex items-center gap-2">
          {totalXp > 0 && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 border border-amber-300">
              +{totalXp} XP earned
            </span>
          )}
          <span className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
            {completedCount}/{missions.length} done
          </span>
        </div>
      </div>
      <div className="space-y-2.5">
        {missions.map((m) => (
          <MissionRow key={m.label} mission={m} />
        ))}
      </div>
      <MissionCompleteBeacon fired={allDone} />
    </div>
  );
}

function MissionRow({ mission }: { mission: Mission }) {
  const { emoji, label, count, target, xp, tooltip } = mission;
  const done = count >= target;
  const empty = count === 0;
  const pct = Math.min(100, (count / target) * 100);

  return (
    <div className="rounded-xl border border-[#c9a24b]/40 bg-white px-3 py-2" title={tooltip}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-base flex-none">{emoji}</span>
          <span
            className={`text-sm font-semibold truncate ${
              done ? "text-emerald-700" : empty ? "text-gray-400" : "text-[#0b1a33]"
            }`}
            title={tooltip}
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
        className="mt-1.5 h-1.5 w-full rounded-full overflow-hidden"
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

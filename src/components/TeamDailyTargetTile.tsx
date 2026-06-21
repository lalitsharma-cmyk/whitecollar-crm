import { prisma } from "@/lib/prisma";

// "Team daily target" tile — rolling team-level call target progress.
//
// Team target = SUM of dailyCallTarget across all active AGENT/MANAGER users on
// the team (default 30 each). Done = count of CallLog rows started today whose
// user is on the same team.
//
// Server component — keeps the dashboard's "scoped via team filter" pattern.
// Hidden when team === "all" because the dashboard doesn't have a meaningful
// "all-teams" target view yet (Mehak's split across Dubai/India makes the
// aggregate misleading).

export default async function TeamDailyTargetTile({
  team,
  todayStart,
}: {
  team: "Dubai" | "India" | "all";
  todayStart: Date;
}) {
  if (team === "all") return null;

  const teamUsers = await prisma.user.findMany({
    where: { team, active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
    select: { id: true, dailyCallTarget: true },
  });

  if (teamUsers.length === 0) return null;

  const teamCallTarget = teamUsers.reduce(
    (sum, u) => sum + (u.dailyCallTarget ?? 30),
    0,
  );

  const teamCallsToday = await prisma.callLog.count({
    where: {
      startedAt: { gte: todayStart },
      user: { team },
    },
  });

  const pct = teamCallTarget > 0
    ? Math.min(200, Math.round((teamCallsToday / teamCallTarget) * 100))
    : 0;
  const remaining = Math.max(0, teamCallTarget - teamCallsToday);
  const agentAvg = teamUsers.length > 0
    ? Math.round((teamCallsToday / teamUsers.length) * 10) / 10
    : 0;

  // Color tiers: <50% red, 50-90% amber, 90-99% emerald, >=100% emerald-gold
  const isOver = teamCallsToday >= teamCallTarget;
  const barColor =
    pct >= 100 ? "bg-gradient-to-r from-emerald-500 to-amber-400" :
    pct >= 90 ? "bg-emerald-500" :
    pct >= 50 ? "bg-amber-500" :
    "bg-red-500";
  const borderColor =
    pct >= 100 ? "border-amber-500" :
    pct >= 90 ? "border-emerald-500" :
    pct >= 50 ? "border-amber-500" :
    "border-red-500";
  const numberColor =
    pct >= 100 ? "text-amber-600" :
    pct >= 90 ? "text-emerald-700" :
    pct >= 50 ? "text-amber-700" :
    "text-red-700";

  const flagEmoji = team === "Dubai" ? "🇦🇪" : "🇮🇳";
  // Cap visible width at 100% so the bar doesn't overflow when team overshoots
  const barWidth = Math.min(100, pct);

  return (
    <div className={`card p-4 border-l-4 ${borderColor}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold tracking-widest uppercase text-gray-500">
          {flagEmoji} Team daily target
        </div>
        <div className="text-[10px] text-gray-400">{pct}%</div>
      </div>
      <div className={`text-2xl lg:text-3xl font-extrabold mt-1 ${numberColor}`}>
        {teamCallsToday} <span className="text-gray-400 font-bold">/ {teamCallTarget}</span>
        <span className="text-xs font-semibold text-gray-500 ml-1">calls</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all`}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      <div className="text-[11px] mt-2 font-semibold">
        {isOver ? (
          <span className="text-emerald-700">✅ Team target hit!</span>
        ) : (
          <span className="text-gray-700">
            💡 Need {remaining} more call{remaining === 1 ? "" : "s"} to hit today&apos;s team target
          </span>
        )}
      </div>
      <div className="text-[10px] text-gray-500 mt-1">
        From {teamUsers.length} agent{teamUsers.length === 1 ? "" : "s"}, average {agentAvg} call{agentAvg === 1 ? "" : "s"} each
      </div>
    </div>
  );
}

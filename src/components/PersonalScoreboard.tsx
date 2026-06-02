import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, CallOutcome, LeadStatus } from "@prisma/client";
import { startOfWeek } from "date-fns";
import {
  levelForXp,
  parseBadgeIds,
  BADGES,
  type BadgeId,
} from "@/lib/gamification";
import QualityScoreCard from "./QualityScoreCard";

// "Your scoreboard" widget — personal gamification snapshot for the dashboard.
//
// Shows the agent's current level + XP progress, their 3 streaks (daily,
// follow-up, cold-call), their RANK in 3 weekly leaderboards (most calls,
// highest connect rate, most follow-ups), and earned badges.
//
// Server component — pulls counts directly via prisma so it streams in with
// the rest of the dashboard. Reuses the leaderboards page's query patterns
// verbatim so the rank numbers match what the agent sees on /leaderboards.
// Sample window matches /leaderboards (top 10) — anyone outside that is
// shown as "Unranked".
//
// IMPORTANT: keep this cheap. The dashboard already runs ~30 queries and
// this adds 4 more (user + 3 leaderboards). Don't add per-row joins.

const SAMPLE_SIZE = 10;

export default async function PersonalScoreboard({ userId }: { userId: string }) {
  // weekStartsOn: 1 → Monday, matching /leaderboards
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      xp: true,
      dailyStreak: true,
      followupStreak: true,
      coldCallStreak: true,
      badges: true,
      // role needed so the embedded QualityScoreCard knows whether to hide
      // the wellbeing axis (manager viewing a report — privacy line per
      // docs/SPEC-quality-score.md §4). For self-view, wellbeing stays.
      role: true,
    },
  });

  if (!user) return null;

  const xp = user.xp ?? 0;
  const info = levelForXp(xp);
  const { level, next, progressPct } = info;
  const dailyStreak = user.dailyStreak ?? 0;
  const followupStreak = user.followupStreak ?? 0;
  const coldCallStreak = user.coldCallStreak ?? 0;
  const earnedBadges = parseBadgeIds(user.badges);
  const badgeMap = new Map(BADGES.map((b) => [b.id, b] as const));

  // Same eligibility filter as /leaderboards — only active sales-floor users
  // count toward the rankings.
  const eligibleUsers = await prisma.user.findMany({
    where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
    select: { id: true },
  });
  const eligibleIds = eligibleUsers.map((u) => u.id);

  // ── 1. Most calls (this week) ──────────────────────────────────────
  const callsAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: weekStart }, userId: { in: eligibleIds } },
    orderBy: { _count: { userId: "desc" } },
    take: SAMPLE_SIZE,
  });
  const callsRank = findRank(callsAgg.map((c) => c.userId), userId);
  const callsTotal = callsAgg.length;

  // ── 2. Most follow-ups completed (this week) ───────────────────────
  const followupsAgg = await prisma.activity.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      type: ActivityType.TASK,
      status: ActivityStatus.DONE,
      completedAt: { gte: weekStart },
      userId: { in: eligibleIds },
    },
    orderBy: { _count: { userId: "desc" } },
    take: SAMPLE_SIZE,
  });
  const followupsRank = findRank(
    followupsAgg.map((r) => r.userId).filter((id): id is string => !!id),
    userId,
  );
  const followupsTotal = followupsAgg.filter((r) => !!r.userId).length;

  // ── 3. Highest connect rate (this week, min 5 calls — same gate as
  //      /leaderboards) ────────────────────────────────────────────────
  const totalsAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: weekStart }, userId: { in: eligibleIds } },
  });
  const connectedAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      startedAt: { gte: weekStart },
      userId: { in: eligibleIds },
      outcome: CallOutcome.CONNECTED,
    },
  });
  const connectedByUser = new Map(connectedAgg.map((c) => [c.userId, c._count._all]));
  const connectRanked = totalsAgg
    .filter((t) => t._count._all >= 5)
    .map((t) => ({
      userId: t.userId,
      pct: (connectedByUser.get(t.userId) ?? 0) / t._count._all,
    }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, SAMPLE_SIZE);
  const connectRank = findRank(connectRanked.map((r) => r.userId), userId);
  const connectTotal = connectRanked.length;

  // ── Star of the Month — most WON deals in current calendar month ──
  // Lalit's signed-off definition: highest count of leads moved to WON whose
  // updatedAt falls in the current calendar month (UTC-month, same as the rest
  // of the dashboard's "this month" tiles use). One groupBy + one user fetch,
  // both indexed on (ownerId, status).
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const topWonGroup = await prisma.lead.groupBy({
    by: ["ownerId"],
    where: {
      status: LeadStatus.WON,
      updatedAt: { gte: monthStart },
      ownerId: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { ownerId: "desc" } },
    take: 1,
  });
  const topRow = topWonGroup[0];
  let starOfMonth: { name: string; wins: number } | null = null;
  if (topRow?.ownerId && topRow._count._all > 0) {
    const winner = await prisma.user.findUnique({
      where: { id: topRow.ownerId },
      select: { name: true },
    });
    if (winner) starOfMonth = { name: winner.name, wins: topRow._count._all };
  }

  return (
    <div className="card p-4 lg:p-5 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/40 to-white">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg" aria-hidden>🏅</span>
        <h2 className="font-bold text-base text-[#0b1a33]">Your scoreboard</h2>
        <span className="ml-auto text-[10px] uppercase tracking-widest text-gray-500">This week</span>
      </div>

      {/* Star of the Month ribbon — most WON deals this calendar month.
          Always visible; quietly says "No bookings yet" rather than hiding
          so the team sees the slot and competes for it. */}
      <div
        title="Most leads moved to WON status this calendar month. Updates live."
        className="mb-3 rounded-xl border-2 border-[#c9a24b] bg-gradient-to-r from-amber-100 via-amber-50 to-white px-3 py-2 flex items-center gap-2 flex-wrap"
      >
        <span className="text-base" aria-hidden>🏆</span>
        <span className="text-[10px] uppercase tracking-widest font-bold text-[#7a5a10]">
          Star of the Month
        </span>
        <span className="text-sm font-bold text-[#0b1a33]">
          {starOfMonth
            ? `${starOfMonth.name} (${starOfMonth.wins} deal${starOfMonth.wins === 1 ? "" : "s"})`
            : "No bookings yet this month"}
        </span>
      </div>

      {/* Level chip + XP progress bar */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0b1a33] text-white text-xs font-bold shadow-sm">
            <span aria-hidden>⭐</span>
            {level.name}
          </span>
          <div className="text-[11px] text-gray-600">
            <b className="text-[#0b1a33]">{xp.toLocaleString("en-IN")}</b> XP
            {next ? (
              <> · {(next.min - xp).toLocaleString("en-IN")} to <b className="text-[#0b1a33]">{next.name}</b></>
            ) : (
              <> · <b className="text-[#0b1a33]">Max level</b></>
            )}
          </div>
        </div>
        <div
          className="relative h-2 rounded-full overflow-hidden bg-[#0b1a33]/10"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Progress to ${next?.name ?? "max level"}`}
        >
          <div
            className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out rounded-full"
            style={{
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-primary-2) 100%)",
            }}
          />
        </div>
      </div>

      {/* Streak chips */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <StreakChip emoji="🔥" label="Daily" value={dailyStreak} tone="amber" />
        <StreakChip emoji="🎯" label="Follow-up" value={followupStreak} tone="emerald" />
        <StreakChip emoji="🧊" label="Cold call" value={coldCallStreak} tone="blue" />
      </div>

      {/* Quality Score — headline composite (Activity 30 + Funnel 35 +
          Behavioural 25 + Wellbeing 10). Sits ABOVE the rank pills so the
          QS is the headline and the per-board ranks read as detail.
          Self-view → role="AGENT" semantically (own data, wellbeing visible).
          When the viewer IS a manager opening their own scoreboard, that's
          still "self" so wellbeing shows — the API hides it only when
          MANAGER views a DIFFERENT user. */}
      <div className="mb-3">
        <QualityScoreCard userId={userId} window="week" viewerRole={user.role} />
      </div>

      {/* Rank pills */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <RankPill
          emoji="📞"
          rank={callsRank}
          total={callsTotal}
          suffix="in calls"
          tooltip="Total CallLog rows since Monday. Top 10 only — outside top 10 shows Unranked."
        />
        <RankPill
          emoji="🎯"
          rank={followupsRank}
          total={followupsTotal}
          suffix="in follow-ups"
          tooltip="Activity rows (type=TASK, status=DONE) since Monday."
        />
        <RankPill
          emoji="📈"
          rank={connectRank}
          total={connectTotal}
          suffix="in connect rate"
          tooltip="Connected ÷ total calls since Monday. Min 5 calls required to rank."
        />
      </div>

      {/* Earned badges */}
      {earnedBadges.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5">Badges earned</div>
          <div className="flex flex-wrap gap-1.5">
            {earnedBadges.map((id) => {
              const b = badgeMap.get(id);
              if (!b) return null;
              return (
                <span
                  key={id}
                  title={b.desc}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#fdf6e3] border border-[#e7c97a] text-[11px] font-semibold text-[#0b1a33]"
                >
                  <span aria-hidden>{b.emoji}</span>
                  {b.name}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Return 1-based rank of userId in an ordered list, or null if not present. */
function findRank(orderedIds: string[], userId: string): number | null {
  const i = orderedIds.indexOf(userId);
  return i === -1 ? null : i + 1;
}

function StreakChip({
  emoji,
  label,
  value,
  tone,
}: {
  emoji: string;
  label: string;
  value: number;
  tone: "amber" | "emerald" | "blue";
}) {
  const toneClass =
    tone === "amber"
      ? "bg-amber-100 text-amber-900 border-amber-300"
      : tone === "emerald"
      ? "bg-emerald-100 text-emerald-900 border-emerald-300"
      : "bg-blue-100 text-blue-900 border-blue-300";
  const display = value > 0 ? `${value}d` : "—";
  return (
    <span
      title={`${label} streak: ${value} day${value === 1 ? "" : "s"}`}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${toneClass}`}
    >
      <span aria-hidden>{emoji}</span>
      {label} <b>{display}</b>
    </span>
  );
}

function RankPill({
  emoji,
  rank,
  total,
  suffix,
  tooltip,
}: {
  emoji: string;
  rank: number | null;
  total: number;
  suffix: string;
  tooltip?: string;
}) {
  const isTop = rank !== null && rank <= 3;
  const tone = isTop
    ? "bg-[#fdf6e3] border-[#e7c97a] text-[#7a5a10]"
    : rank !== null
    ? "bg-slate-100 border-slate-200 text-slate-700"
    : "bg-slate-50 border-slate-200 text-slate-500";
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${tone}`}
    >
      <span aria-hidden>{emoji}</span>
      {rank !== null ? (
        <>
          <b>#{rank}</b>
          {total > 0 && <span className="text-[10px] opacity-80">/ {total}</span>}
          <span>{suffix}</span>
        </>
      ) : (
        <>Unranked {suffix}</>
      )}
    </span>
  );
}

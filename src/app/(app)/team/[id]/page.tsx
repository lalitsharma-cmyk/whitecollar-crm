import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import AdminPasswordReset from "@/components/AdminPasswordReset";
import { startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { ActivityType, ActivityStatus, CallOutcome } from "@prisma/client";
import { activityVisual } from "@/lib/activityIcon";
import { fmtMoneyDual } from "@/lib/money";
import { fmtIST12 } from "@/lib/datetime";
import {
  BADGES,
  levelForXp,
  parseBadgeIds,
  type BadgeId,
} from "@/lib/gamification";

export const dynamic = "force-dynamic";

const roleChip: Record<string, string> = {
  ADMIN: "chip-hot",
  MANAGER: "chip-warm",
  AGENT: "chip-new",
};

interface Tile {
  label: string;
  value: string | number;
  hint?: string;
}

function TileGrid({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <div className="card p-4 lg:p-5 space-y-3">
      <div className="font-semibold text-sm uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="text-[11px] uppercase tracking-wider text-slate-500">
              {t.label}
            </div>
            <div className="text-xl lg:text-2xl font-bold text-[#0b1a33] mt-1 tabular-nums">
              {t.value}
            </div>
            {t.hint && (
              <div className="text-[11px] text-slate-500 mt-0.5">{t.hint}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface RankRow {
  title: string;
  emoji: string;
  rank: number | null;
  total: number;
  display: string;
  lowerIsBetter?: boolean;
}

export default async function AgentDeepDivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) notFound();

  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const monthStart = startOfMonth(now);

  // ── Today's performance ─────────────────────────────────────────
  const [
    callsToday,
    connectedToday,
    followupsDoneToday,
    coldToWarmToday,
  ] = await Promise.all([
    prisma.callLog.count({
      where: { userId: id, startedAt: { gte: todayStart } },
    }),
    prisma.callLog.count({
      where: {
        userId: id,
        startedAt: { gte: todayStart },
        outcome: CallOutcome.CONNECTED,
      },
    }),
    prisma.activity.count({
      where: {
        userId: id,
        type: ActivityType.TASK,
        status: ActivityStatus.DONE,
        completedAt: { gte: todayStart },
      },
    }),
    prisma.activity.count({
      where: {
        userId: id,
        type: ActivityType.COLD_TO_LEAD,
        completedAt: { gte: todayStart },
      },
    }),
  ]);

  // ── This week ───────────────────────────────────────────────────
  const [
    callsWeek,
    connectedWeek,
    meetingsBookedWeek,
    siteVisitsDoneWeek,
  ] = await Promise.all([
    prisma.callLog.count({
      where: { userId: id, startedAt: { gte: weekStart } },
    }),
    prisma.callLog.count({
      where: {
        userId: id,
        startedAt: { gte: weekStart },
        outcome: CallOutcome.CONNECTED,
      },
    }),
    prisma.activity.count({
      where: {
        userId: id,
        type: { in: [ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING] },
        createdAt: { gte: weekStart },
      },
    }),
    prisma.activity.count({
      where: {
        userId: id,
        type: ActivityType.SITE_VISIT,
        status: ActivityStatus.DONE,
        completedAt: { gte: weekStart },
      },
    }),
  ]);

  // ── This month ──────────────────────────────────────────────────
  const [
    totalLeadsOwned,
    activeLeadsOwned,
    bookingsDoneMonth,
    pipelineRows,
  ] = await Promise.all([
    prisma.lead.count({ where: { ownerId: id } }),
    prisma.lead.count({
      where: { ownerId: id, status: { notIn: ["WON", "LOST"] } },
    }),
    prisma.lead.count({
      where: {
        ownerId: id,
        status: { in: ["BOOKING_DONE", "WON"] },
        bookingDoneAt: { gte: monthStart },
      },
    }),
    prisma.$queryRaw<
      Array<{ currency: string; total: number }>
    >`
      SELECT COALESCE("budgetCurrency", 'AED') AS currency, SUM("budgetMin")::float AS total
      FROM "Lead"
      WHERE "ownerId" = ${id}
        AND "status"::text IN ('NEW','CONTACTED','QUALIFIED','SITE_VISIT','NEGOTIATION')
        AND "budgetMin" IS NOT NULL
      GROUP BY COALESCE("budgetCurrency", 'AED')
    `,
  ]);

  const pipeline = { aed: 0, inr: 0 };
  for (const row of pipelineRows) {
    const total = Number(row.total) || 0;
    if ((row.currency || "AED").toUpperCase() === "INR") pipeline.inr += total;
    else pipeline.aed += total;
  }

  // ── Leaderboard ranks (this week, mirrors leaderboards/page.tsx patterns) ──
  const eligibleUsers = await prisma.user.findMany({
    where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
    select: { id: true, dailyStreak: true },
  });
  const eligibleIds = eligibleUsers.map((u) => u.id);
  const totalEligible = eligibleIds.length;
  const isEligible = eligibleIds.includes(id);

  // 1. Most calls
  const callsAgg = await prisma.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: { startedAt: { gte: weekStart }, userId: { in: eligibleIds } },
  });
  const callsSorted = [...callsAgg].sort(
    (a, b) => b._count._all - a._count._all
  );
  const callsRank = callsSorted.findIndex((c) => c.userId === id);
  const callsValue = callsSorted.find((c) => c.userId === id)?._count._all ?? 0;

  // 2. Fastest response
  const fastestRaw = await prisma.$queryRaw<
    Array<{ userId: string; avg_min: number }>
  >`
    WITH first_calls AS (
      SELECT DISTINCT ON (cl."leadId")
        cl."leadId",
        cl."userId",
        cl."startedAt",
        l."createdAt" AS lead_created
      FROM "CallLog" cl
      JOIN "Lead" l ON l.id = cl."leadId"
      WHERE cl."leadId" IS NOT NULL
        AND cl."startedAt" >= ${weekStart}
      ORDER BY cl."leadId", cl."startedAt" ASC
    )
    SELECT
      "userId",
      AVG(EXTRACT(EPOCH FROM ("startedAt" - lead_created)) / 60.0)::float AS avg_min
    FROM first_calls
    WHERE EXTRACT(EPOCH FROM ("startedAt" - lead_created)) >= 0
    GROUP BY "userId"
    ORDER BY avg_min ASC
  `;
  const fastestEligible = fastestRaw.filter((r) => eligibleIds.includes(r.userId));
  const fastestRank = fastestEligible.findIndex((r) => r.userId === id);
  const fastestValue = fastestEligible.find((r) => r.userId === id)?.avg_min;

  // 3. Most follow-ups
  const followupsAgg = await prisma.activity.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      type: ActivityType.TASK,
      status: ActivityStatus.DONE,
      completedAt: { gte: weekStart },
      userId: { in: eligibleIds },
    },
  });
  const followupsSorted = [...followupsAgg]
    .filter((r) => r.userId)
    .sort((a, b) => b._count._all - a._count._all);
  const followupsRank = followupsSorted.findIndex((r) => r.userId === id);
  const followupsValue =
    followupsSorted.find((r) => r.userId === id)?._count._all ?? 0;

  // 4. Highest connect rate (min 5 sample)
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
  const connectedByUser = new Map(
    connectedAgg.map((c) => [c.userId, c._count._all])
  );
  const connectRateRows = totalsAgg
    .filter((t) => t._count._all >= 5)
    .map((t) => {
      const conn = connectedByUser.get(t.userId) ?? 0;
      const pct = (conn / t._count._all) * 100;
      return { userId: t.userId, pct };
    })
    .sort((a, b) => b.pct - a.pct);
  const connectRank = connectRateRows.findIndex((r) => r.userId === id);
  const connectValue = connectRateRows.find((r) => r.userId === id)?.pct;

  // 5. Cold-to-warm
  const coldAgg = await prisma.activity.groupBy({
    by: ["userId"],
    _count: { _all: true },
    where: {
      type: ActivityType.COLD_TO_LEAD,
      completedAt: { gte: weekStart },
      userId: { in: eligibleIds },
    },
  });
  const coldSorted = [...coldAgg]
    .filter((r) => r.userId)
    .sort((a, b) => b._count._all - a._count._all);
  const coldRank = coldSorted.findIndex((r) => r.userId === id);
  const coldValue = coldSorted.find((r) => r.userId === id)?._count._all ?? 0;

  // 6. Most consistent
  const consistentSorted = [...eligibleUsers]
    .filter((u) => u.dailyStreak > 0)
    .sort((a, b) => b.dailyStreak - a.dailyStreak);
  const consistentRank = consistentSorted.findIndex((u) => u.id === id);
  const consistentValue = user.dailyStreak;

  const ranks: RankRow[] = [
    {
      title: "Most calls",
      emoji: "📞",
      rank: callsRank >= 0 ? callsRank + 1 : null,
      total: totalEligible,
      display: `${callsValue} calls`,
    },
    {
      title: "Fastest response",
      emoji: "⚡",
      rank: fastestRank >= 0 ? fastestRank + 1 : null,
      total: totalEligible,
      display:
        fastestValue != null ? `${fastestValue.toFixed(1)} min` : "no data",
      lowerIsBetter: true,
    },
    {
      title: "Most follow-ups",
      emoji: "🎯",
      rank: followupsRank >= 0 ? followupsRank + 1 : null,
      total: totalEligible,
      display: `${followupsValue} tasks`,
    },
    {
      title: "Highest connect rate",
      emoji: "📈",
      rank: connectRank >= 0 ? connectRank + 1 : null,
      total: totalEligible,
      display:
        connectValue != null ? `${connectValue.toFixed(1)}%` : "<5 calls",
    },
    {
      title: "Cold-to-warm",
      emoji: "🔥",
      rank: coldRank >= 0 ? coldRank + 1 : null,
      total: totalEligible,
      display: `${coldValue} promoted`,
    },
    {
      title: "Most consistent",
      emoji: "🏆",
      rank: consistentRank >= 0 ? consistentRank + 1 : null,
      total: totalEligible,
      display: `${consistentValue} day streak`,
    },
  ];

  // ── XP / Level ──────────────────────────────────────────────────
  const xpInfo = levelForXp(user.xp);

  // ── Badges ──────────────────────────────────────────────────────
  const earnedBadgeIds = parseBadgeIds(user.badges);
  const badgeMap = new Map(BADGES.map((b) => [b.id, b] as const));
  const earnedBadges = earnedBadgeIds
    .map((bid) => badgeMap.get(bid))
    .filter((b): b is (typeof BADGES)[number] => Boolean(b));

  // ── Recent activity ─────────────────────────────────────────────
  const recentActivity = await prisma.activity.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { lead: { select: { id: true, name: true } } },
  });

  // ── Specializations ─────────────────────────────────────────────
  const specs = (user.specializations ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const initials = user.name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("");

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/team"
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← Back to Team
        </Link>
      </div>

      {/* Top row: Header card + Today */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Header card */}
        <div className="card p-5 space-y-4">
          <div className="flex items-start gap-4">
            {user.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.photoUrl}
                alt={user.name}
                className="w-16 h-16 rounded-full object-cover object-top border border-slate-200"
              />
            ) : (
              <div
                className={`avatar w-16 h-16 text-xl ${
                  user.avatarColor ?? "bg-slate-500"
                }`}
              >
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl lg:text-2xl font-bold text-[#0b1a33]">
                {user.name}
              </h1>
              <div className="text-sm text-slate-500">{user.email}</div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`chip ${roleChip[user.role]}`}>{user.role}</span>
                {user.team && (
                  <span className="chip chip-new">{user.team}</span>
                )}
                <span
                  className={`chip ${
                    user.active ? "chip-new" : "chip-hot"
                  }`}
                >
                  {user.active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
          </div>

          {/* Specializations */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
              Specializations
            </div>
            {specs.length === 0 ? (
              <div className="text-sm text-slate-400">None set</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {specs.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#fdf6e3] border border-[#e7c97a] text-[11px] text-[#0b1a33]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Daily call target */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="text-sm text-slate-600">Daily call target</div>
            <div className="text-sm font-semibold text-[#0b1a33]">
              {user.dailyCallTarget} calls/day
            </div>
          </div>

          {/* XP + Level + Streak */}
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-base text-[#0b1a33] truncate">
                  {xpInfo.level.name}
                </div>
                <div className="text-[11px] text-slate-500">
                  {user.xp.toLocaleString("en-IN")} XP
                  {xpInfo.next && (
                    <>
                      {" · next: "}
                      <b className="text-[#0b1a33]">{xpInfo.next.name}</b>
                      {" at "}
                      {xpInfo.next.min.toLocaleString("en-IN")}
                    </>
                  )}
                  {!xpInfo.next && (
                    <> · <b className="text-[#0b1a33]">Max level reached</b></>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  Streak
                </div>
                <div className="text-lg font-bold text-[#0b1a33]">
                  🔥 {user.dailyStreak}d
                </div>
              </div>
            </div>
            <div
              className="relative h-2 rounded-full overflow-hidden bg-[#0b1a33]/10"
              role="progressbar"
              aria-valuenow={xpInfo.progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progress to ${xpInfo.next?.name ?? "max level"}`}
            >
              <div
                className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out rounded-full"
                style={{
                  width: `${xpInfo.progressPct}%`,
                  background:
                    "linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-primary-2) 100%)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Today's performance */}
        <TileGrid
          title="Today"
          tiles={[
            { label: "Calls today", value: callsToday },
            { label: "Connected", value: connectedToday },
            { label: "Follow-ups done", value: followupsDoneToday },
            { label: "Cold-to-warm", value: coldToWarmToday },
          ]}
        />
      </div>

      {/* Middle row: This week / This month / Rank */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <TileGrid
          title="This week"
          tiles={[
            { label: "Calls", value: callsWeek },
            { label: "Connected", value: connectedWeek },
            { label: "Meetings booked", value: meetingsBookedWeek },
            { label: "Site visits done", value: siteVisitsDoneWeek },
          ]}
        />
        <TileGrid
          title="This month"
          tiles={[
            { label: "Total leads owned", value: totalLeadsOwned },
            { label: "Active leads", value: activeLeadsOwned },
            { label: "Pipeline value", value: fmtMoneyDual(pipeline) },
            { label: "Bookings done", value: bookingsDoneMonth },
          ]}
        />
      </div>

      {/* Leaderboard ranks */}
      <div className="card p-4 lg:p-5 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div className="font-semibold text-sm uppercase tracking-wider text-slate-500">
            Leaderboard rank (this week)
          </div>
          <Link
            href="/leaderboards?range=week"
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            View all leaderboards →
          </Link>
        </div>
        {!isEligible ? (
          <div className="text-sm text-slate-500 py-4">
            This user isn't ranked (admin/inactive).
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ranks.map((r) => (
              <div
                key={r.title}
                className="rounded-lg border border-slate-200 bg-white p-3 flex items-center gap-3"
              >
                <span className="text-2xl shrink-0" aria-hidden>
                  {r.emoji}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#0b1a33] truncate">
                    {r.title}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {r.display}
                    {r.lowerIsBetter && " · lower = better"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {r.rank == null ? (
                    <span className="text-xs text-slate-400">unranked</span>
                  ) : (
                    <div className="text-sm font-bold text-[#0b1a33] tabular-nums">
                      #{r.rank}
                      <span className="text-xs text-slate-500 font-normal">
                        {" / "}
                        {r.total}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom row: Badges + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Badges */}
        <div className="card p-4 lg:p-5 space-y-3">
          <div className="font-semibold text-sm uppercase tracking-wider text-slate-500">
            Badges earned ({earnedBadges.length} / {BADGES.length})
          </div>
          {earnedBadges.length === 0 ? (
            <div className="text-sm text-slate-500 py-4">
              No badges earned yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {earnedBadges.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-3 rounded-lg border border-[#e7c97a] bg-[#fdf6e3] p-2"
                >
                  <span
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white border border-[#e7c97a] text-xl shrink-0"
                    aria-hidden
                  >
                    {b.emoji}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[#0b1a33] truncate">
                      {b.name}
                    </div>
                    <div className="text-[11px] text-slate-600">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Unearned badges */}
          {earnedBadges.length < BADGES.length && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 mt-3 mb-1.5">
                Not yet earned
              </div>
              <div className="flex flex-wrap gap-1.5">
                {BADGES.filter(
                  (b) => !(earnedBadgeIds as BadgeId[]).includes(b.id)
                ).map((b) => (
                  <span
                    key={b.id}
                    title={`${b.name} — ${b.desc}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[11px] grayscale opacity-70"
                  >
                    <span aria-hidden>{b.emoji}</span>
                    {b.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="card p-4 lg:p-5 space-y-3">
          <div className="font-semibold text-sm uppercase tracking-wider text-slate-500">
            Recent activity (last 15)
          </div>
          {recentActivity.length === 0 ? (
            <div className="text-sm text-slate-500 py-4">No activity yet.</div>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((a) => {
                const v = activityVisual(a.type);
                return (
                  <div key={a.id} className="flex gap-3 items-start">
                    <div
                      className={`w-8 h-8 rounded-full ${v.dot} text-white flex items-center justify-center text-sm flex-none shadow-sm`}
                    >
                      {v.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <b>{a.title}</b>
                        <span className="text-[10px] text-gray-400 ml-1">
                          · {v.label}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.lead ? (
                          <Link
                            href={`/leads/${a.lead.id}`}
                            className="hover:underline"
                          >
                            {a.lead.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {" · "}
                        {fmtIST12(a.createdAt)} IST
                      </div>
                      {a.description && (
                        <div className="text-sm mt-1 text-gray-700 whitespace-pre-wrap line-clamp-2">
                          {a.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Admin-only: reset this agent's password */}
      {me.role === "ADMIN" && (
        <div className="card p-4 lg:p-5">
          <div className="font-semibold text-sm uppercase tracking-wider text-slate-500 mb-3">
            🔒 Reset password (admin only)
          </div>
          <AdminPasswordReset userId={user.id} />
        </div>
      )}
    </div>
  );
}

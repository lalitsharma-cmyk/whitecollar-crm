import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { SUPPRESSED_STATUSES, statusColor } from "@/lib/lead-statuses";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { startOfDay, startOfWeek } from "date-fns";
import Link from "next/link";
import ColdDataAdminControls from "@/components/ColdDataAdminControls";
import HiddenGemsBanner, { type HiddenGem } from "@/components/HiddenGemsBanner";
import DailyRevivalMission from "@/components/DailyRevivalMission";
import RevivalLeaderboard, { type LeaderboardRow } from "@/components/RevivalLeaderboard";
import RevivalEngineListClient from "@/components/RevivalEngineListClient";
import { REVIVAL_STATUSES } from "@/lib/revival-constants";
import { REVIVAL_MISSION } from "@/lib/missions";

export const dynamic = "force-dynamic";

// 💎 REVIVAL ENGINE — cold data pipeline with status-based filtering.
//
// Leads with leadOrigin="COLD" are shown here exclusively. Agents see only
// their assigned rows. "Promote to Lead" flips leadOrigin → "ACTIVE" and
// the row moves into /leads.
//
// Filter tabs are now STATUS-based (NEW, CONTACTED, QUALIFIED…) matching the
// same statuses used in the main /leads pipeline. "Stages" concept removed.

const COLD_DAYS = REVIVAL_MISSION.dormantDays;

// Status colors come from statusColor() — no stage mapping needed.

export default async function ColdDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;

  // Active status filter — "all" means no status restriction
  const statusFilter = sp.status ?? "all";
  const cutoff = new Date(Date.now() - COLD_DAYS * 86400 * 1000);
  const todayStart = startOfDay(new Date());
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";

  // Agents only see cold data assigned to them. Admin sees everything.
  const baseScope: Prisma.LeadWhereInput = isAdminOrMgr ? {} : { ownerId: me.id };
  const originCold: Prisma.LeadWhereInput = { leadOrigin: { in: COLD_ORIGINS } };
  const unassigned: Prisma.LeadWhereInput = { ownerId: null };

  // Status-based filter — "all" shows everything, "unassigned" is admin shortcut
  const statusWhere: Prisma.LeadWhereInput =
    statusFilter === "unassigned"
      ? unassigned
      : REVIVAL_STATUSES.some(s => s.v === statusFilter)
        ? { currentStatus: statusFilter }
        : {};

  const allCold: Prisma.LeadWhereInput = { AND: [baseScope, originCold] };
  const where: Prisma.LeadWhereInput = { AND: [baseScope, originCold, statusWhere] };

  // Hidden-gem filter: high-value dormant leads
  const hiddenGemsWhere: Prisma.LeadWhereInput = {
    AND: [
      baseScope,
      { isColdCall: true },
      {
        OR: [
          { budgetMin: { gt: REVIVAL_MISSION.hiddenGemBudgetThreshold } },
          { aiScore: "HOT" },
        ],
      },
      { lastTouchedAt: { lt: cutoff } },
      { currentStatus: { notIn: SUPPRESSED_STATUSES } },
    ],
  };

  const [
    leads,
    totalCount,
    unassignedCount,
    agents,
    convertedTodayCount,
    hiddenGemsRaw,
    weeklyRevivals,
    ...statusCountResults
  ] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { owner: true },
      orderBy: { lastTouchedAt: "asc" },
      take: 200,
    }),
    prisma.lead.count({ where: allCold }),
    isAdminOrMgr ? prisma.lead.count({ where: { AND: [originCold, unassigned] } }) : Promise.resolve(0),
    isAdminOrMgr
      ? prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER", "ADMIN"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
    prisma.activity.count({
      where: {
        type: "COLD_TO_LEAD",
        completedAt: { gte: todayStart },
        ...(isAdminOrMgr ? {} : { userId: me.id }),
      },
    }),
    prisma.lead.findMany({
      where: hiddenGemsWhere,
      orderBy: { lastTouchedAt: "asc" },
      take: 10,
      select: {
        id: true, name: true, phone: true, company: true, city: true,
        budgetMin: true, budgetCurrency: true, aiScore: true, lastTouchedAt: true,
      },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { type: "COLD_TO_LEAD", completedAt: { gte: weekStart }, userId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    }),
    // Count per status for filter tabs
    ...REVIVAL_STATUSES.map(s =>
      prisma.lead.count({ where: { AND: [baseScope, originCold, { currentStatus: s.v }] } })
    ),
  ]);

  // Build statusCounts map: { NEW: 5, CONTACTED: 12, … }
  const statusCounts: Record<string, number> = {};
  REVIVAL_STATUSES.forEach((s, i) => {
    statusCounts[s.v] = (statusCountResults[i] as number) ?? 0;
  });

  // Leaderboard name resolution
  const leaderboardUserIds = weeklyRevivals.map(r => r.userId).filter((id): id is string => id != null);
  const leaderboardUsers = leaderboardUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: leaderboardUserIds } }, select: { id: true, name: true } })
    : [];
  const userNameById = new Map(leaderboardUsers.map(u => [u.id, u.name]));
  const top5: LeaderboardRow[] = weeklyRevivals
    .filter(r => r.userId)
    .map(r => ({
      ownerId: r.userId as string,
      name: userNameById.get(r.userId as string) ?? "Unknown",
      count: r._count._all,
      isMe: r.userId === me.id,
    }));

  const hiddenGems: HiddenGem[] = hiddenGemsRaw.map(g => ({
    id: g.id, name: g.name, phone: g.phone, company: g.company, city: g.city,
    budgetMin: g.budgetMin, budgetCurrency: g.budgetCurrency, aiScore: g.aiScore,
    lastTouchedAt: g.lastTouchedAt,
  }));

  const streak = me.coldCallStreak ?? 0;

  return (
    <>
      {/* ───────── COLD DATA NOTICE ───────── */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800 flex items-center gap-2">
        <span className="font-semibold">❄ Cold Data</span>
        <span className="text-blue-700">— Not yet promoted to active leads. Use &quot;Promote to Lead&quot; to move a contact into your live pipeline.</span>
      </div>

      {/* ───────── HEADER ───────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">💎 Revival Engine</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Convert dormant leads into active deals
            {isAdminOrMgr ? " · admin view (all agents)" : ""}
          </p>
          <div className="mt-1 text-[11px] text-emerald-700 font-semibold">
            🎯 {convertedTodayCount} promoted to Lead today {isAdminOrMgr ? "(team)" : "(you)"}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totalCount > 0 ? (
            <Link
              href="/cold-calls/session"
              className="btn bg-orange-600 text-white text-sm font-bold shadow hover:bg-orange-700"
            >
              🎯 Start session ({totalCount} leads)
            </Link>
          ) : (
            <span className="btn bg-gray-200 text-gray-400 text-sm font-bold cursor-not-allowed" aria-disabled="true">
              No cold leads available
            </span>
          )}
          {isAdminOrMgr && (
            <ColdDataAdminControls agents={agents.map(a => ({ id: a.id, name: a.name, team: a.team }))} />
          )}
        </div>
      </div>

      {/* ───────── DAILY MISSION (full width) ───────── */}
      <DailyRevivalMission count={convertedTodayCount} target={REVIVAL_MISSION.dailyCallTarget} />

      {/* ───────── HIDDEN GEMS (horizontal scroll) ───────── */}
      <HiddenGemsBanner gems={hiddenGems} />

      {/* ───────── TWO-COLUMN: list (left) + leaderboard/streak (right) ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:gap-6">
        {/* ─── LEFT: leads list ─── */}
        <div className="space-y-3 min-w-0">

          {/* Status-based filter tabs */}
          <div className="seg flex-wrap">
            <Link href="/cold-calls" className={statusFilter === "all" ? "on" : ""}>
              All · {totalCount}
            </Link>
            {isAdminOrMgr && (
              <Link href="/cold-calls?status=unassigned" className={statusFilter === "unassigned" ? "on" : ""}>
                ⚠ Unassigned · {unassignedCount}
              </Link>
            )}
            {REVIVAL_STATUSES.map(s => (
              <Link
                key={s.v}
                href={`/cold-calls?status=${s.v}`}
                className={statusFilter === s.v ? "on" : ""}
              >
                {s.label} · {statusCounts[s.v] ?? 0}
              </Link>
            ))}
          </div>

          {statusFilter === "unassigned" && isAdminOrMgr && leads.length === 0 && (
            <div className="card p-8 text-center text-gray-500 text-sm">
              No unassigned cold data. Import a batch with the Import button above.
            </div>
          )}

          <RevivalEngineListClient
            leads={leads.map(l => ({
              id:             l.id,
              name:           l.name,
              phone:          l.phone,
              company:        l.company ?? null,
              city:           l.city ?? null,
              isColdCall:     l.isColdCall,
              leadOrigin:     l.leadOrigin,
              status:         l.status,
              statusChip:     statusColor(l.currentStatus),
              lastTouchedAt:  l.lastTouchedAt,
              ownerId:        l.ownerId,
              owner:          l.owner ? { name: l.owner.name } : null,
              coldCallReason: l.coldCallReason ?? null,
              alreadyBought:  l.alreadyBought ?? null,
              alreadyBoughtBy: l.alreadyBoughtBy ?? null,
            }))}
            myId={me.id}
            isAdminOrMgr={isAdminOrMgr}
            cutoffMs={cutoff.getTime()}
            coldDays={COLD_DAYS}
          />
        </div>

        {/* ─── RIGHT: leaderboard + streak ─── */}
        <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
          <RevivalLeaderboard top5={top5} />
          <div className="card p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Your cold-call streak</div>
                <div className="text-2xl font-bold tabular-nums leading-tight">
                  {streak} <span className="text-sm font-normal text-gray-500">days</span>
                </div>
              </div>
              <span className="text-2xl" aria-hidden>
                {streak > 0 ? "🔥" : "✨"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500 leading-snug">
              {streak > 0
                ? "Keep showing up — streaks compound XP."
                : "Make one cold call today to start a streak."}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

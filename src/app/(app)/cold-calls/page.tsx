import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadStatus, Prisma } from "@prisma/client";
import { formatDistanceToNow, startOfDay, startOfWeek } from "date-fns";
import Link from "next/link";
import { whatsappLink, telLink } from "@/lib/phone";
import ColdCallToggle from "@/components/ColdCallToggle";
import ColdDataPromoteButton from "@/components/ColdDataPromoteButton";
import ColdDataAdminControls from "@/components/ColdDataAdminControls";
import HiddenGemsBanner, { type HiddenGem } from "@/components/HiddenGemsBanner";
import DailyRevivalMission from "@/components/DailyRevivalMission";
import RevivalLeaderboard, { type LeaderboardRow } from "@/components/RevivalLeaderboard";
import { REVIVAL_MISSION } from "@/lib/missions";

export const dynamic = "force-dynamic";

// 💎 REVIVAL ENGINE — rebrand of the old "Cold Data" page (master spec §9.6).
//
// Admin imports a CSV/Excel batch and assigns rows to agents. Agents see only
// their assigned rows. When connected and qualified, agent taps "Promote to
// Lead" which flips isColdCall=false → the row moves into the main /leads
// pipeline as the agent's owned lead and disappears here.
//
// The "Revival Engine" framing wraps the same data in a treasure-hunt
// aesthetic: Hidden Gems (high-value dormant leads) surfaced on top, a daily
// mission with progress bar, and a weekly leaderboard for cold-to-warm
// revivals. Goal: make this work FEEL rewarding instead of dreary.
//
// Three sub-buckets stay the same:
//   • Unassigned (admin only) — freshly imported, not yet given to anyone
//   • Assigned to me (agent + admin) — active cold data being worked
//   • BANT not qualified — leads that turned cold post-qualification
//   • 30d+ stale — abandoned leads worth a fresh outbound

const COLD_DAYS = REVIVAL_MISSION.dormantDays;

export default async function ColdDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const showOnly = sp.kind ?? "all";
  const cutoff = new Date(Date.now() - COLD_DAYS * 86400 * 1000);
  const todayStart = startOfDay(new Date());
  // Week boundary for the leaderboard. weekStartsOn:1 = Monday — matches Lalit's
  // existing weekly-report convention (sales week resets Monday IST).
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";

  // Agents only see cold data assigned to them. Admin sees everything.
  const baseScope: Prisma.LeadWhereInput = isAdminOrMgr ? {} : { ownerId: me.id };

  const manualCold: Prisma.LeadWhereInput = { isColdCall: true };
  const bantNot: Prisma.LeadWhereInput = { bantStatus: "NOT_QUALIFIED" };
  const stale: Prisma.LeadWhereInput = {
    status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
    lastTouchedAt: { lt: cutoff },
    isColdCall: false,
    bantStatus: { not: "NOT_QUALIFIED" },
  };
  const unassigned: Prisma.LeadWhereInput = { isColdCall: true, ownerId: null };
  const allCold: Prisma.LeadWhereInput = { AND: [baseScope, { OR: [manualCold, bantNot, stale] }] };

  const where: Prisma.LeadWhereInput =
    showOnly === "unassigned" ? { AND: [{}, unassigned] } :   // admin-only view
    showOnly === "manual" ? { AND: [baseScope, manualCold] } :
    showOnly === "bant"   ? { AND: [baseScope, bantNot] } :
    showOnly === "stale"  ? { AND: [baseScope, stale] } :
    allCold;

  // Hidden-gem filter: cold + (high budget OR HOT score) + dormant 30d+ + not closed.
  // Scoped to the same baseScope as everything else so agents only see THEIR gems
  // and admin sees the team's. Take 10 — enough for a scroll, not overwhelming.
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
      { status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
    ],
  };

  const [
    leads,
    manualCount,
    bantCount,
    staleCount,
    totalCount,
    unassignedCount,
    agents,
    convertedTodayCount,
    hiddenGemsRaw,
    coldCallsTodayCount,
    weeklyRevivals,
  ] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { owner: true },
      orderBy: { lastTouchedAt: "asc" },
      take: 200,
    }),
    prisma.lead.count({ where: { AND: [baseScope, manualCold] } }),
    prisma.lead.count({ where: { AND: [baseScope, bantNot] } }),
    prisma.lead.count({ where: { AND: [baseScope, stale] } }),
    prisma.lead.count({ where: allCold }),
    isAdminOrMgr ? prisma.lead.count({ where: unassigned }) : Promise.resolve(0),
    isAdminOrMgr ? prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    // Conversions today: cold-to-lead activities scoped to me (or all if admin)
    prisma.activity.count({
      where: {
        type: "COLD_TO_LEAD",
        completedAt: { gte: todayStart },
        ...(isAdminOrMgr ? {} : { userId: me.id }),
      },
    }),
    // Hidden gems — high-value dormant leads worth a fresh attempt.
    prisma.lead.findMany({
      where: hiddenGemsWhere,
      orderBy: { lastTouchedAt: "asc" },
      take: 10,
      select: {
        id: true,
        name: true,
        phone: true,
        company: true,
        city: true,
        budgetMin: true,
        budgetCurrency: true,
        aiScore: true,
        lastTouchedAt: true,
      },
    }),
    // Today's cold-call count for this agent — drives the mission progress bar.
    // Counts CallLog rows the agent created today against any Lead.isColdCall=true.
    prisma.callLog.count({
      where: {
        userId: me.id,
        startedAt: { gte: todayStart },
        lead: { isColdCall: true },
      },
    }),
    // Weekly leaderboard — cold-to-warm revivals per agent this week.
    // "Revived" = lead was cold (isColdCall flag history not tracked, so we use
    // the activity log as the canonical signal) AND status is now CONTACTED or
    // further AND it happened this week. We use the COLD_TO_LEAD Activity row
    // as the proxy — it's written exactly once when the agent promotes a cold
    // row to a real lead, and ActivityType already has it (schema.prisma:465).
    prisma.activity.groupBy({
      by: ["userId"],
      where: {
        type: "COLD_TO_LEAD",
        completedAt: { gte: weekStart },
        userId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take: 5,
    }),
  ]);

  // Resolve userIds → names for the leaderboard. Single round-trip lookup so
  // the group-by doesn't need a join (Prisma group-by can't include relations).
  const leaderboardUserIds = weeklyRevivals
    .map((r) => r.userId)
    .filter((id): id is string => id != null);
  const leaderboardUsers = leaderboardUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: leaderboardUserIds } },
        select: { id: true, name: true },
      })
    : [];
  const userNameById = new Map(leaderboardUsers.map((u) => [u.id, u.name]));
  const top5: LeaderboardRow[] = weeklyRevivals
    .filter((r) => r.userId)
    .map((r) => ({
      ownerId: r.userId as string,
      name: userNameById.get(r.userId as string) ?? "Unknown",
      count: r._count._all,
      isMe: r.userId === me.id,
    }));

  // Shape gems for the client component — keep the prop surface narrow so
  // we never accidentally leak unrelated lead fields.
  const hiddenGems: HiddenGem[] = hiddenGemsRaw.map((g) => ({
    id: g.id,
    name: g.name,
    phone: g.phone,
    company: g.company,
    city: g.city,
    budgetMin: g.budgetMin,
    budgetCurrency: g.budgetCurrency,
    aiScore: g.aiScore,
    lastTouchedAt: g.lastTouchedAt,
  }));

  // Agent's current cold-call streak — shown in the right-rail "Streak" card.
  // Field maintained by the gamification engine (see schema.prisma:59).
  const streak = me.coldCallStreak ?? 0;

  return (
    <>
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
        {isAdminOrMgr && (
          <ColdDataAdminControls agents={agents.map((a) => ({ id: a.id, name: a.name, team: a.team }))} />
        )}
      </div>

      {/* ───────── DAILY MISSION (full width) ───────── */}
      <DailyRevivalMission count={coldCallsTodayCount} target={REVIVAL_MISSION.dailyCallTarget} />

      {/* ───────── HIDDEN GEMS (horizontal scroll) ───────── */}
      <HiddenGemsBanner gems={hiddenGems} />

      {/* ───────── TWO-COLUMN: list (left) + leaderboard/streak (right) ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 lg:gap-6">
        {/* ─── LEFT: existing cold-data list ─── */}
        <div className="space-y-3 min-w-0">
          {/* Sub-bucket tabs */}
          <div className="seg flex-wrap">
            <Link href="/cold-calls" className={showOnly === "all" ? "on" : ""}>All · {totalCount}</Link>
            {isAdminOrMgr && (
              <Link href="/cold-calls?kind=unassigned" className={showOnly === "unassigned" ? "on" : ""}>⚠ Unassigned · {unassignedCount}</Link>
            )}
            <Link href="/cold-calls?kind=manual" className={showOnly === "manual" ? "on" : ""}>Manual cold · {manualCount}</Link>
            <Link href="/cold-calls?kind=bant" className={showOnly === "bant" ? "on" : ""}>BANT not qualified · {bantCount}</Link>
            <Link href="/cold-calls?kind=stale" className={showOnly === "stale" ? "on" : ""}>{COLD_DAYS}d+ stale · {staleCount}</Link>
          </div>

          {leads.length === 0 && (
            <div className="card p-8 text-center text-gray-500 text-sm">
              {showOnly === "unassigned" && isAdminOrMgr
                ? "No unassigned cold data. Import a batch with the Import button above."
                : "Nothing in this bucket. Either you're on top of follow-ups (✅) or no leads in this stage."}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {leads.map((l) => {
              const wa = l.phone ? whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) : "";
              const tel = l.phone ? telLink(l.phone) : "";
              const reasonChips: { label: string; cls: string }[] = [];
              if (l.isColdCall) reasonChips.push({ label: "Cold data", cls: "chip-cold" });
              if (l.bantStatus === "NOT_QUALIFIED") reasonChips.push({ label: "BANT ❌", cls: "chip-lost" });
              if (l.lastTouchedAt && l.lastTouchedAt < cutoff && !l.isColdCall && l.bantStatus !== "NOT_QUALIFIED") {
                reasonChips.push({ label: `${COLD_DAYS}d+ stale`, cls: "chip-warm" });
              }
              const isUnassigned = !l.ownerId;

              return (
                <div key={l.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/leads/${l.id}`} className="font-bold text-sm hover:underline truncate block">{l.name}</Link>
                      <div className="text-[11px] text-gray-500 truncate">{l.phone}</div>
                    </div>
                    <ColdCallToggle leadId={l.id} initial={l.isColdCall} />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {reasonChips.map((c, i) => <span key={i} className={`chip ${c.cls} text-[9px]`}>{c.label}</span>)}
                    {isUnassigned && <span className="chip chip-hot text-[9px]">UNASSIGNED</span>}
                    {l.alreadyBought && <span className="chip src text-[9px]" title={l.alreadyBought}>🏠 owns</span>}
                  </div>
                  {l.coldCallReason && <div className="text-[11px] text-gray-700 mt-1 italic">&quot;{l.coldCallReason}&quot;</div>}
                  {l.alreadyBought && (
                    <div className="text-[11px] text-gray-700 mt-1">
                      <b>Already owns:</b> {l.alreadyBought}{l.alreadyBoughtBy && ` (via ${l.alreadyBoughtBy})`}
                    </div>
                  )}
                  <div className="text-[11px] text-gray-500 mt-2">
                    {l.owner ? `Owner: ${l.owner.name}` : "Unassigned"} · last touch {l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: true }) : "never"}
                  </div>
                  {l.phone && (
                    <div className="flex gap-2 mt-2">
                      <a href={tel} className="btn text-xs bg-emerald-600 text-white flex-1 justify-center">📞 Call</a>
                      <a href={wa} target="_blank" rel="noopener noreferrer" className="btn text-xs bg-[#25D366] text-white flex-1 justify-center">💬 WhatsApp</a>
                    </div>
                  )}
                  {/* Promote-to-Lead — agents (and admin) get this when row is theirs */}
                  {(l.ownerId === me.id || isAdminOrMgr) && (
                    <div className="mt-2">
                      <ColdDataPromoteButton leadId={l.id} leadName={l.name} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

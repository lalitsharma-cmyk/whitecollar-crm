import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { SUPPRESSED_STATUSES, statusColor, INDIA_STATUSES, DUBAI_STATUSES, compareStatusDisplay } from "@/lib/lead-statuses";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { leadFilterWhere, leadFilterOrderBy } from "@/lib/leadFilterWhere";
import { getAvailableMediums } from "@/lib/mediumManager";
import { projectWhereForUser } from "@/lib/propertyScope";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { startOfDay, startOfWeek } from "date-fns";
import Link from "next/link";
import ColdDataAdminControls from "@/components/ColdDataAdminControls";
import HiddenGemsBanner, { type HiddenGem } from "@/components/HiddenGemsBanner";
import DailyRevivalMission from "@/components/DailyRevivalMission";
import RevivalLeaderboard, { type LeaderboardRow } from "@/components/RevivalLeaderboard";
import RevivalEngineListClient from "@/components/RevivalEngineListClient";
import LeadFilters from "@/components/LeadFilters";
import SavedFiltersBar from "@/components/SavedFiltersBar";
import { REVIVAL_MISSION } from "@/lib/missions";

export const dynamic = "force-dynamic";

// 💎 REVIVAL ENGINE — cold data pipeline with the SAME list experience as /leads.
//
// Leads with leadOrigin in COLD_ORIGINS (or isColdCall) are shown here exclusively.
// Agents see only their assigned rows. "Promote to Lead" flips leadOrigin → ACTIVE
// and the row moves into /leads.
//
// PARITY (DRY — reuses the Leads building blocks):
//   • Filters  → shared <LeadFilters> panel + leadFilterWhere() (team/owner/status/
//                source/medium/tags/date/follow-up/search), scoped to cold/revival data.
//   • Saved Views → shared <SavedFiltersBar> (URL-query Smart Lists, /api/saved-filters).
//   • Bulk actions → assign / team / status / reject / export via /api/leads/bulk
//                    (reassign routes through assignLeadTo → Assignment row + notify).
//   • Search → the LeadFilters search box (?q=) translated by leadFilterWhere.
//   • Columns → same column set as Leads (Lead/Status/Owner/Last touch/Source/Medium),
//               sortable, plus Revival-only bits (stale badge, cold reason, promote).
//
// Status filter tabs use the SAME statuses as /leads (INDIA_STATUSES + DUBAI_STATUSES).
// "Stages" concept removed — Revival Engine is status-aligned with Leads.

const COLD_DAYS = REVIVAL_MISSION.dormantDays;

// All possible statuses across both teams — Revival serves cold data from both.
const ALL_POSSIBLE_STATUSES = new Set([...INDIA_STATUSES, ...DUBAI_STATUSES]);

const PAGE_SIZE = 200;

export default async function ColdDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;

  // Active status filter — "all" means no status restriction. Kept as a top-level
  // param (?status=) for the chip-tab UX, AND-composed with the shared filters.
  const statusFilter = sp.status ?? "all";
  const cutoff = new Date(Date.now() - COLD_DAYS * 86400 * 1000);
  const todayStart = startOfDay(new Date());
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const isAgent = me.role === "AGENT";

  // Agents only see cold data assigned to them. Admin/manager see everything.
  const baseScope: Prisma.LeadWhereInput = isAdminOrMgr ? {} : { ownerId: me.id };
  // CRITICAL: deletedAt:null lives on originCold so EVERY count built on it (All
  // tab via allCold, filteredCount via where, the per-status chips) excludes
  // soft-deleted cold leads consistently. Without it, the "All" count would
  // exceed Σ(status chips) — which DO filter deletedAt:null (line ~166) — the
  // moment any cold lead is soft-deleted. Matches the rest of the CRM (recycle
  // bin is never counted).
  const originCold: Prisma.LeadWhereInput = { leadOrigin: { in: COLD_ORIGINS }, deletedAt: null };
  const unassigned: Prisma.LeadWhereInput = { ownerId: null };

  // ── Shared filter translation (same engine as /leads + /master-data) ────────
  // leadFilterWhere() turns the LeadFilters panel params (q, cstatus, source,
  // medium, owner, team, project, budget, follow-up, date range, tags, …) into an
  // AND-composed array. Role-gating is the caller's job: AGENTs can't filter by
  // owner or source, so we strip those params before translation.
  const filterSp = { ...sp };
  if (isAgent) {
    delete filterSp.owner;
    delete filterSp.source;
  }
  const sharedAnd = leadFilterWhere(filterSp);

  // Status-tab filter — "all" shows everything, "unassigned" is an admin shortcut.
  // Uses actual status text (e.g., "Fresh Lead", "Follow Up").
  const statusWhere: Prisma.LeadWhereInput =
    statusFilter === "unassigned"
      ? unassigned
      : statusFilter !== "all" && (ALL_POSSIBLE_STATUSES as Set<string>).has(statusFilter)
        ? { currentStatus: statusFilter }
        : {};

  // allCold = everything in scope (for the "All" tab + total). where = the active view.
  const allCold: Prisma.LeadWhereInput = { AND: [baseScope, originCold] };
  const where: Prisma.LeadWhereInput = { AND: [baseScope, originCold, statusWhere, ...sharedAnd] };

  // Hidden-gem filter: high-value dormant leads (Revival-specific — preserved).
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

  // Sort — honour the shared ?sort= (LeadFilters "Sort By"); default = stalest-first
  // (oldest lastTouchedAt), which is the Revival working order (chase dormant first).
  const orderBy: Prisma.LeadOrderByWithRelationInput[] = sp.sort
    ? leadFilterOrderBy(sp)
    : [{ lastTouchedAt: "asc" }];

  const [
    leads,
    totalCount,
    filteredCount,
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
      orderBy,
      take: PAGE_SIZE,
    }),
    prisma.lead.count({ where: allCold }),
    prisma.lead.count({ where }),
    isAdminOrMgr ? prisma.lead.count({ where: { AND: [originCold, unassigned, { deletedAt: null }] } }) : Promise.resolve(0),
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
    // Count per status for filter tabs — counts respect the SHARED filters too, so
    // a chip's number == the rows returned when that status is applied on top of
    // the current filter set (same reconciliation invariant as Leads/Master Data).
    // CRITICAL: deletedAt:null excludes archived/deleted cold leads from counts.
    ...Array.from(ALL_POSSIBLE_STATUSES).map(s =>
      prisma.lead.count({ where: { AND: [baseScope, originCold, { deletedAt: null }, ...sharedAnd, { currentStatus: s }] } })
    ),
  ]);

  // Build statusCounts map: { "Fresh Lead": 5, "Follow Up": 12, … }
  const statusCounts: Record<string, number> = {};
  const statusArray = Array.from(ALL_POSSIBLE_STATUSES);
  statusArray.forEach((s, i) => {
    statusCounts[s] = (statusCountResults[i] as number) ?? 0;
  });
  // Only show status chips that have at least one lead in the current filter set,
  // ordered canonically (Fresh Lead → Office Visit → Follow Up → …). Mirrors Leads.
  const statusChips = statusArray
    .filter(s => (statusCounts[s] ?? 0) > 0)
    .sort(compareStatusDisplay);

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

  // ── Filter-panel option lists (cold/revival-scoped) ─────────────────────────
  // Source + Medium dropdowns + projects, same shape the Leads/Master-Data panels
  // use. Sources are DISTINCT verbatim sourceRaw values seen on cold/revival leads.
  const [sourceRows, mediumOptions, allProjects] = await Promise.all([
    isAgent
      ? Promise.resolve([] as { sourceRaw: string | null }[])
      : prisma.lead.findMany({
          where: { ...originCold, deletedAt: null, sourceRaw: { not: null } },
          distinct: ["sourceRaw"],
          select: { sourceRaw: true },
          orderBy: { sourceRaw: "asc" },
        }),
    getAvailableMediums(),
    prisma.project.findMany({
      where: projectWhereForUser(me),
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const sourceOptions = sourceRows.map(r => r.sourceRaw!).filter(Boolean);

  // DISTINCT tag list over cold/revival leads for the More-Filters tag dropdown.
  const tagRows = await prisma.$queryRaw<Array<{ tag: string }>>`
    SELECT DISTINCT TRIM(t) AS tag
    FROM (
      SELECT UNNEST(string_to_array(tags, ',')) AS t
      FROM "Lead"
      WHERE tags IS NOT NULL AND tags <> ''
        AND ("leadOrigin" IN ('COLD','REVIVAL') OR "isColdCall" = true)
        AND "deletedAt" IS NULL
    ) AS s
    WHERE TRIM(t) <> ''
    ORDER BY tag ASC
  `;
  const distinctTags = tagRows.map(r => r.tag).filter((t): t is string => typeof t === "string" && t.length > 0);

  // Build a query-string of the CURRENT params for the export / bulk-export link.
  const currentParams = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null && v !== "" && k !== "page") p.set(k, String(v));
    return p.toString();
  })();

  const isFiltered = filteredCount !== totalCount;

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
            {isFiltered
              ? <><span className="font-semibold text-[#0b1a33] dark:text-blue-300">{filteredCount} filtered</span> · {totalCount} total cold</>
              : <>Convert dormant leads into active deals{isAdminOrMgr ? " · admin view (all agents)" : ""}</>}
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

          {/* Saved Views — same Smart Lists mechanism as Leads/Master Data */}
          <SavedFiltersBar isAdmin={me.role === "ADMIN"} />

          {/* Shared filter panel (search + team/owner/status/source/medium/tags/date) */}
          <LeadFilters
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            sources={sourceOptions}
            statuses={[]}
            showSource={!isAgent}
            distinctTags={distinctTags}
            projects={allProjects}
            mediums={mediumOptions}
            propertyTypes={PROPERTY_TYPES}
          />

          {/* Status-based filter tabs (Excel/MIS values) — chip count == records applied */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
            {(() => {
              const base = "px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 flex-none whitespace-nowrap";
              const on = "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700";
              const off = "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600";
              const spToParams = () => {
                const p = new URLSearchParams();
                for (const [k, v] of Object.entries(sp)) if (v != null && v !== "" && k !== "page") p.set(k, String(v));
                return p;
              };
              const chipHref = (patch: Record<string, string | null>) => {
                const p = spToParams();
                for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") p.delete(k); else p.set(k, v); }
                const qs = p.toString();
                return qs ? `/cold-calls?${qs}` : "/cold-calls";
              };
              return (
                <>
                  <Link href={chipHref({ status: null })} className={`${base} ${statusFilter === "all" ? on : off}`}>
                    All <span className={`px-1 rounded text-[10px] ${statusFilter === "all" ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{filteredCount}</span>
                  </Link>
                  {isAdminOrMgr && (
                    <Link href={chipHref({ status: statusFilter === "unassigned" ? null : "unassigned" })} className={`${base} ${statusFilter === "unassigned" ? "bg-amber-600 text-white border-amber-600" : "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200"}`}>
                      ⚠ Unassigned <span className={`px-1 rounded text-[10px] ${statusFilter === "unassigned" ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{unassignedCount}</span>
                    </Link>
                  )}
                  {statusChips.map(s => {
                    const active = statusFilter === s;
                    return (
                      <Link key={s} href={chipHref({ status: active ? null : s })} className={`${base} ${active ? on : off}`}>
                        {s} <span className={`px-1 rounded text-[10px] ${active ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{statusCounts[s] ?? 0}</span>
                      </Link>
                    );
                  })}
                </>
              );
            })()}
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
              currentStatus:  l.currentStatus ?? null,
              statusChip:     statusColor(l.currentStatus),
              sourceRaw:      l.sourceRaw ?? null,
              medium:         l.medium ?? null,
              mediumOther:    l.mediumOther ?? null,
              team:           l.forwardedTeam ?? null,
              lastTouchedAt:  l.lastTouchedAt,
              ownerId:        l.ownerId,
              owner:          l.owner ? { name: l.owner.name } : null,
              coldCallReason: l.coldCallReason ?? null,
              alreadyBought:  l.alreadyBought ?? null,
              alreadyBoughtBy: l.alreadyBoughtBy ?? null,
            }))}
            myId={me.id}
            isAdminOrMgr={isAdminOrMgr}
            canExport={!isAgent}
            agents={agents.map(a => ({ id: a.id, name: a.name, team: a.team }))}
            cutoffMs={cutoff.getTime()}
            coldDays={COLD_DAYS}
            exportParams={currentParams}
            showSource={!isAgent}
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

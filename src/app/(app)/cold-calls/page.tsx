import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadSource, Prisma } from "@prisma/client";
import { SUPPRESSED_STATUSES, statusColor, INDIA_STATUSES, DUBAI_STATUSES, compareStatusDisplay, NEEDS_REVIEW } from "@/lib/lead-statuses";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { canExportData, canImportData } from "@/lib/exportPerms";
import { leadFilterWhere } from "@/lib/leadFilterWhere";
import { getAvailableMediums } from "@/lib/mediumManager";
import { projectWhereForUser } from "@/lib/propertyScope";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { displayBudget } from "@/lib/budgetParse";
import { formatLeadName } from "@/lib/leadName";
import { effectiveSource } from "@/lib/sourceLabel";
import { contactActivityByLeadToday } from "@/lib/followupGate";
import { CONTACT_ACTIVITY_TYPES } from "@/lib/dashboardWidgets";
import { startOfDay, startOfWeek, formatDistanceToNow } from "date-fns";
import Link from "next/link";
import ColdDataAdminControls from "@/components/ColdDataAdminControls";
import HiddenGemsBanner, { type HiddenGem } from "@/components/HiddenGemsBanner";
import RevivalLeaderboard, { type LeaderboardRow } from "@/components/RevivalLeaderboard";
import RevivalLeadsListClient, { type RevivalPromoteMeta } from "@/components/RevivalLeadsListClient";
import LeadFilters from "@/components/LeadFilters";
import SavedFiltersBar from "@/components/SavedFiltersBar";
import HelpDot from "@/components/HelpDot";
import { REVIVAL_MISSION } from "@/lib/missions";

export const dynamic = "force-dynamic";

// 💎 REVIVAL ENGINE — cold data pipeline with the SAME list experience as /leads.
//
// Leads with leadOrigin in COLD_ORIGINS (or isColdCall) are shown here exclusively.
// Agents see only their assigned rows. "Promote to Lead" flips leadOrigin → ACTIVE
// and the row moves into /leads.
//
// PARITY (DRY — literally reuses the Leads list component):
//   • The grid/table is the SAME <LeadsListClient> the /leads page mounts — same
//     columns (Property Enquired / Status / Budget / Follow-Up / Assigned / Source /
//     Last Activity / Actions), same per-column header filters + sorting + pagination,
//     same status badges, same row actions (Call/WA/Complete/Snooze/Escalate/Reject/
//     Open). Only the DATA SOURCE differs (cold/revival-scoped) + the detail link
//     points at the cold-data detail page + a Revival-only "Promote to Lead" action
//     rides along via the additive extraRowAction prop. Nothing is forked.
//   • Filters  → shared <LeadFilters> panel + leadFilterWhere() (team/owner/status/
//                source/medium/tags/date/follow-up/search), scoped to cold/revival data.
//   • Saved Views → shared <SavedFiltersBar> (URL-query Smart Lists, /api/saved-filters).
//   • Bulk actions → the LeadsListClient bulk toolbar (Tag / Reassign / Reject /
//                    WhatsApp / Follow-up / Edit-fields) via /api/leads/bulk.
//
// Status filter tabs use the SAME statuses as /leads (INDIA_STATUSES + DUBAI_STATUSES).
// "Stages" concept removed — Revival Engine is status-aligned with Leads.

const COLD_DAYS = REVIVAL_MISSION.dormantDays;

// All possible statuses across both teams — Revival serves cold data from both.
// India ∪ Dubai master statuses PLUS the market-neutral "Needs Review" sentinel — a
// lead flagged for team/status revalidation carries this instead of a market status, so
// including it here gives those leads a real chip + count + filter (never chip-less).
const ALL_POSSIBLE_STATUSES = new Set([...INDIA_STATUSES, ...DUBAI_STATUSES, NEEDS_REVIEW]);

// 50/page — the SAME page size as /leads (Lalit 2026-07-16: Revival pagination must
// behave exactly like Leads). Was a pagination-less `take: 200` cap, which silently
// hid every record past #200 once the Revival pool outgrew it.
const PAGE_SIZE = 50;

// Source enum → chip class + human label (same maps the /leads page uses, so the
// LeadsListClient Source column reads identically here). Kept local (small, static).
const srcChip: Record<LeadSource, string> = {
  WEBSITE: "src-web", WCR_WEBSITE: "src-web", WCR_EVENT: "src-event", LANDING_PAGE: "src-web",
  WHATSAPP: "src-wa", CSV_IMPORT: "src-csv", EVENT: "src-event",
  REFERRAL: "src", INBOUND_CALL: "src-call", FACEBOOK_ADS: "src-web", GOOGLE_ADS: "src-csv",
  PORTAL_99ACRES: "src", PORTAL_MAGICBRICKS: "src", PORTAL_HOUSING: "src", OTHER: "src",
};
// Source DISPLAY label is resolved by effectiveSource() at row-build time (prefers
// verbatim sourceRaw, the SAME field the ?source= filter matches). The enum-keyed
// label map was removed — it collapsed real sourceRaw values (Townscript) to
// "Other". srcChip above stays enum-keyed (cosmetic chip colour only).

export default async function ColdDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;

  // Server-side pagination — identical mechanics to /leads (?page= param → skip).
  // Prev/Next links spread the CURRENT searchParams, so search/filters/tabs/sort
  // persist across pages; changing a filter drops ?page= and restarts at page 1.
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Active status filter — "all" means no status restriction. Kept as a top-level
  // param (?status=) for the chip-tab UX, AND-composed with the shared filters.
  const statusFilter = sp.status ?? "all";
  // India/Dubai Revival split (Lalit): ?market=india|dubai narrows to that market.
  // Filtering flows through leadFilterWhere (→ the view + every chip count); the
  // "All" total also gets it via marketOnlyAnd so counts reconcile per tab.
  const marketFilter = (sp.market ?? "all").toLowerCase();
  const marketOnlyAnd = sp.market ? leadFilterWhere({ market: sp.market }) : [];
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
  // exceed Σ(status chips) — which DO filter deletedAt:null (below) — the moment
  // any cold lead is soft-deleted. Matches the rest of the CRM (recycle bin is
  // never counted). The regression suite asserts this declaration carries both
  // leadOrigin AND deletedAt:null.
  // Revival membership = leadOrigin ∈ COLD_ORIGINS OR isColdCall=true — the SAME
  // definition the lead-detail redirect uses (leads/[id] + cold-data/[id]). Keying on
  // leadOrigin ALONE stranded cold leads whose import set isColdCall but left a
  // non-cold origin (e.g. MASTER_DATA) — invisible in BOTH Revival and Master Data.
  // (Lalit 2026-06-28: today's revival import not showing.)
  // rejectedAt:null → a REJECTED revival lead leaves EVERY active Revival view (it's
  // tagged "Revival Engine Rejected" and archived to Master Data, which shows all
  // origins incl. rejected). Team is preserved on the record. (Lalit 2026-07-03.)
  const originCold: Prisma.LeadWhereInput = { deletedAt: null, rejectedAt: null, OR: [{ leadOrigin: { in: COLD_ORIGINS } }, { isColdCall: true }] };
  // "Unassigned" = workable-unassigned only. A rejected cold lead is unassigned for
  // history; it belongs under Lost/Rejected, never the assign queue (Lalit 2026-06-28).
  const unassigned: Prisma.LeadWhereInput = { ownerId: null, rejectedAt: null };

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
  // The status chip-tab is applied via statusWhere below; strip it here so
  // leadFilterWhere doesn't ALSO inject {currentStatus: status}. For the sentinels
  // ("unassigned"/"__fresh__") that injection matched no row → an EMPTY list while the
  // chip count stayed non-zero (count≠rows). (Lalit 2026-06-28 reconciliation audit.)
  delete filterSp.status;
  const sharedAnd = leadFilterWhere(filterSp);

  // Status-tab filter — "all" shows everything, "unassigned" is an admin shortcut,
  // "__fresh__" = leads with NO status yet (null/blank) so Σ(status chips) == All
  // even though ~45 cold leads carry no MIS status (they'd otherwise get no chip).
  // Uses actual status text (e.g., "Fresh Lead", "Follow Up") for the rest.
  const FRESH_SENTINEL = "__fresh__";
  const unstatusedWhere: Prisma.LeadWhereInput = { OR: [{ currentStatus: null }, { currentStatus: "" }] };
  const statusWhere: Prisma.LeadWhereInput =
    statusFilter === "unassigned"
      ? unassigned
      : statusFilter === FRESH_SENTINEL
        ? unstatusedWhere
        : statusFilter !== "all" && (ALL_POSSIBLE_STATUSES as Set<string>).has(statusFilter)
          ? { currentStatus: statusFilter }
          : {};

  // allCold = everything in scope (for the "All" tab + total). where = the active view.
  const allCold: Prisma.LeadWhereInput = { AND: [baseScope, originCold, ...marketOnlyAnd] };
  const where: Prisma.LeadWhereInput = { AND: [baseScope, originCold, statusWhere, ...sharedAnd] };

  // Hidden-gem filter: high-value dormant leads (Revival-specific — preserved).
  // deletedAt/rejectedAt:null mirror the main list's originCold clause so a
  // recycled or Revival-rejected cold lead can never resurface in the banner
  // (the banner otherwise bypassed both exclusions the list enforces).
  const hiddenGemsWhere: Prisma.LeadWhereInput = {
    AND: [
      baseScope,
      { isColdCall: true },
      { deletedAt: null },
      { rejectedAt: null },
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

  // Sort — honour the SAME ?sort= keys the LeadsListClient sortable column headers
  // emit (name/status/budget/followup/owner/created/touched, asc+desc), so clicking
  // a header on /cold-calls sorts exactly like /leads. Default (no ?sort=) =
  // stalest-first (oldest lastTouchedAt), the Revival working order (chase dormant
  // first). Mirrors the /leads orderBy switch.
  let orderBy: Prisma.LeadOrderByWithRelationInput[];
  switch (sp.sort) {
    case "created_asc":  orderBy = [{ createdAt: "asc" }]; break;
    case "created_desc": orderBy = [{ createdAt: "desc" }]; break;
    case "touched_asc":  orderBy = [{ lastTouchedAt: "asc" }]; break;
    case "touched_desc": orderBy = [{ lastTouchedAt: "desc" }]; break;
    case "name_asc":     orderBy = [{ name: "asc" }]; break;
    case "name_desc":    orderBy = [{ name: "desc" }]; break;
    case "budget_asc":   orderBy = [{ budgetMin: "asc" }]; break;
    case "budget_desc":  orderBy = [{ budgetMin: "desc" }]; break;
    case "status_asc":   orderBy = [{ currentStatus: "asc" }]; break;
    case "status_desc":  orderBy = [{ currentStatus: "desc" }]; break;
    case "followup_asc": orderBy = [{ followupDate: "asc" }]; break;
    case "followup_desc":orderBy = [{ followupDate: "desc" }]; break;
    case "owner_asc":    orderBy = [{ owner: { name: "asc" } }]; break;
    case "owner_desc":   orderBy = [{ owner: { name: "desc" } }]; break;
    default:             orderBy = [{ lastTouchedAt: "asc" }];
  }

  const [
    leads,
    totalCount,
    filteredCount,
    unassignedCount,
    unstatusedCount,
    agents,
    convertedTodayCount,
    hiddenGemsRaw,
    weeklyRevivals,
    statusCountRows,
  ] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        owner: { select: { name: true, avatarColor: true } },
        interestedUnits: { take: 1, select: { unit: { select: { configuration: true, project: { select: { name: true } } } } } },
        discussed: { take: 3, select: { project: { select: { name: true } } } },
        callLogs: { orderBy: { startedAt: "desc" }, take: 20, select: { outcome: true, startedAt: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true } },
      },
      orderBy,
      take: PAGE_SIZE,
      skip,
    }),
    prisma.lead.count({ where: allCold }),
    prisma.lead.count({ where }),
    isAdminOrMgr ? prisma.lead.count({ where: { AND: [baseScope, originCold, { deletedAt: null }, ...sharedAnd, unassigned] } }) : Promise.resolve(0),
    // Fresh/Unstatused chip count — cold leads with NO MIS status (null/blank) in
    // the current filter set. Mirrors the per-status chip recipe so All == Σ chips.
    prisma.lead.count({ where: { AND: [baseScope, originCold, { deletedAt: null }, ...sharedAnd, unstatusedWhere] } }),
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
    // Count per status for filter tabs — ONE groupBy replaces the former ~44
    // per-status COUNT queries (one round-trip instead of 44). Same base scope
    // the old loop used (baseScope + originCold [carries deletedAt/rejectedAt:null]
    // + the shared filters), so a chip's number == the rows returned when that
    // status is applied on top of the current filter set — identical reconciliation
    // invariant as Leads/Master Data. Mirrors the /leads groupBy shape exactly.
    prisma.lead.groupBy({
      by: ["currentStatus"],
      where: { AND: [baseScope, originCold, { deletedAt: null }, ...sharedAnd] },
      _count: { _all: true },
    }),
  ]);

  // Build statusCounts map: { "Fresh Lead": 5, "Follow Up": 12, … } from the
  // groupBy rows. Statuses absent from the result (no rows) default to 0, so the
  // per-status chips read identically to the old per-status COUNT loop.
  const statusCounts: Record<string, number> = {};
  const statusArray = Array.from(ALL_POSSIBLE_STATUSES);
  const statusCountByValue = new Map<string, number>(
    statusCountRows
      .filter((r): r is typeof r & { currentStatus: string } => r.currentStatus != null)
      .map(r => [r.currentStatus, r._count._all])
  );
  statusArray.forEach((s) => {
    statusCounts[s] = statusCountByValue.get(s) ?? 0;
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


  // Contact-today flags (gates the Complete row button) — one batch query over the
  // visible page, same helper + meaning as /leads.
  const leadIds = leads.map(l => l.id);
  const contactTodaySet = leadIds.length > 0
    ? await contactActivityByLeadToday(leadIds)
    : new Set<string>();

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

  // Build a query-string of the CURRENT params, used by the LeadsListClient
  // header-filter + sort links so they round-trip on /cold-calls.
  const searchParamsStr = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v!)])
  ).toString();

  const isFiltered = filteredCount !== totalCount;

  // ── Map the cold/revival rows into the EXACT LeadsListClient Row shape ───────
  // Identical mapping to /leads (formatLeadName, BANT count, displayBudget,
  // last-activity, connected/no-answer history, sourceDetail/projectHint, …) so
  // the grid renders the SAME for cold/revival leads — only the data source and
  // the detail link differ. intelligenceMatch is null (cold data isn't intel-matched).
  const listRows = leads.map((l) => {
    const bantCount = [
      l.budgetMin != null && l.budgetMin > 0,
      l.authorityLevel != null && l.authorityLevel !== "UNKNOWN",
      l.needSummary != null && l.needSummary.trim().length > 0,
      l.whenCanInvest != null && l.whenCanInvest !== "UNKNOWN",
    ].filter(Boolean).length;

    return {
      id: l.id,
      name: formatLeadName(l.name),
      phone: l.phone,
      email: l.email,
      source: l.source,
      statusName: l.currentStatus ?? "",
      currentStatus: l.currentStatus ?? null,
      srcChip: srcChip[l.source],
      // Same normalized field the Source filter matches (verbatim sourceRaw, e.g.
      // "Townscript"), enum label only as a legacy fallback — so the Source column
      // and the ?source= filter agree here exactly as on /leads. (Was the enum-
      // keyed srcLabel[l.source], which showed "Other" for real Townscript rows.)
      srcLabel: effectiveSource(l.sourceRaw, l.source),
      statusChip: statusColor(l.currentStatus),
      aiScore: l.aiScore,
      aiScoreValue: l.aiScoreValue,
      team: l.forwardedTeam,
      owner: l.owner ? { name: l.owner.name, avatarColor: l.owner.avatarColor ?? "bg-slate-500" } : null,
      budgetFormatted: (() => { const d = displayBudget(l); return d === "—" ? null : d; })(),
      bantCount,
      needSummary: l.needSummary ?? null,
      discussedProjects: l.discussed.map((d) => d.project.name),
      lastTouched: l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: false }) : null,
      lastTouchedAt: l.lastTouchedAt ? l.lastTouchedAt.toISOString() : null,
      todoNext: l.todoNext ?? null,
      // IST-rendered (matches /leads + the adjacent enquiryDate) — an IST-midnight
      // follow-up was showing as the prior day under date-fns' server-UTC format.
      followupDate: l.followupDate ? new Date(l.followupDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : null,
      followupRaw: l.followupDate ? new Date(l.followupDate).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null,
      enquiryDate: l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit" }) : null,
      // Created Time blanks when unknown (imported row with no Time column → createdTimeKnown=false).
      enquiryTime: l.createdTimeKnown === false ? null : (l.createdAt ? new Date(l.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }) : null),
      enquiryRaw: l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null,
      city: l.city ?? null,
      whenCanInvest: l.whenCanInvest ?? null,
      remarks: l.remarks ? l.remarks.slice(0, 120) : null,
      lastActivityType: l.callLogs.length > 0 ? "CALL"
        : l.activities.length > 0 ? l.activities[0].type
        : null,
      lastActivityAt: l.callLogs[0]?.startedAt?.toISOString()
        ?? l.activities[0]?.createdAt?.toISOString()
        ?? null,
      connectedCount: l.callLogs.filter(c => ["CONNECTED", "INTERESTED"].includes(c.outcome)).length,
      notPickedCount: l.callLogs.filter(c => ["NOT_PICKED", "BUSY", "SWITCHED_OFF"].includes(c.outcome)).length,
      hasContactToday: contactTodaySet.has(l.id),
      intelligenceMatch: null,
      budget: (() => { const d = displayBudget(l); return d === "—" ? null : d; })(),
      interest: l.interestedUnits[0] ? `${l.interestedUnits[0].unit.project.name} ${l.interestedUnits[0].unit.configuration}` : null,
      sourceDetail: l.sourceDetail ?? null,
      projectHint: l.notesShort ?? null,
    };
  });

  // Promote-to-Lead per-row action (Revival-only) — preserved alongside the
  // standard Leads row actions. Built as a SERIALIZABLE map (id → {canPromote,
  // isOriginCold}) so the server page can hand it to the client list wrapper,
  // which renders the actual Promote button. canPromote = admin/manager OR the
  // owner. isOriginCold picks the endpoint (leadOrigin COLD/REVIVAL → /promote;
  // legacy isColdCall-only → /promote-cold) — the SAME split the old
  // RevivalEngineListClient used, so Revival keeps its promote capability 1:1.
  const promoteMeta: Record<string, RevivalPromoteMeta> = {};
  for (const l of leads) {
    promoteMeta[l.id] = {
      canPromote: isAdminOrMgr || l.ownerId === me.id,
      isOriginCold: l.leadOrigin === "COLD" || l.leadOrigin === "REVIVAL",
    };
  }

  return (
    <>
      {/* ───────── COLD DATA NOTICE ───────── */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-2 text-sm text-blue-800 dark:text-blue-300 flex items-center gap-2">
        <span className="font-semibold">❄ Cold Data</span>
        <span className="text-blue-700 dark:text-blue-400">— Not yet promoted to active leads. Use &quot;Promote to Lead&quot; to move a contact into your live pipeline.</span>
      </div>

      {/* ───────── HEADER ───────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold">💎 Revival Engine</h1>
            {process.env.NEXT_PUBLIC_SANDBOX === "1" && <HelpDot topic="cold-calls" />}
          </div>
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
            <span className="btn bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-500 text-sm font-bold cursor-not-allowed" aria-disabled="true">
              No cold leads available
            </span>
          )}
          {canImportData(me) && (
            <ColdDataAdminControls agents={agents.map(a => ({ id: a.id, name: a.name, team: a.team }))} />
          )}
          {/* Revival export — OWNER (Super Admin) only, matching the server gate
              (watermarked + audited). CSV for spreadsheets, Excel for .xlsx. */}
          {canExportData(me) && (
            <span className="inline-flex items-center gap-1">
              <a href="/api/reports/export?type=revival" className="btn btn-ghost text-sm" title="Export active revival leads (CSV)">⬇ Export CSV</a>
              <a href="/api/reports/export?type=revival&format=xlsx" className="btn btn-ghost text-sm" title="Export active revival leads (Excel)">⬇ Excel</a>
            </span>
          )}
        </div>
      </div>

      {/* ───────── HIDDEN GEMS (horizontal scroll) ───────── */}
      <HiddenGemsBanner gems={hiddenGems} />

      {/* ───────── COMPACT REVIVAL LEADERS strip (full width, single thin row) —
           Today's Mission + cold-call-streak widgets removed (Lalit 2026-07-02):
           the working Revival data (search → filters → records) starts right after
           this thin strip, no marketing/dashboard space. ───────── */}
      <RevivalLeaderboard top5={top5} />

      {/* ───────── FULL-WIDTH: leads list (table spans the whole row) ───────── */}
      <div className="space-y-3 min-w-0">

          {/* Saved Views — same Smart Lists mechanism as Leads/Master Data */}
          <SavedFiltersBar isAdmin={me.role === "ADMIN"} />

          {/* Shared filter panel (search + team/owner/status/source/medium/tags/date).
              showMeetingVisit={false}: Revival Engine is calling-only (Lalit
              2026-07-16) — meetings/site visits are not Revival activities, so the
              "Has meeting"/"Has site visit" filter options are not presented here.
              Historical meeting activities still render on lead timelines. */}
          <LeadFilters
            agents={agents.map((a) => ({ id: a.id, name: a.name }))}
            sources={sourceOptions}
            statuses={[]}
            showSource={!isAgent}
            distinctTags={distinctTags}
            projects={allProjects}
            mediums={mediumOptions}
            propertyTypes={PROPERTY_TYPES}
            showMeetingVisit={false}
          />

          {/* India / Dubai Revival split — market tabs (admin/manager). Preserves the
              current status + filters via the shared param-carry-through. */}
          {isAdminOrMgr && (
            <div className="flex gap-2">
              {(() => {
                const params = () => {
                  const p = new URLSearchParams();
                  for (const [k, v] of Object.entries(sp)) if (v != null && v !== "" && k !== "page") p.set(k, String(v));
                  return p;
                };
                const mHref = (m: string | null) => {
                  const p = params();
                  if (m) p.set("market", m); else p.delete("market");
                  const qs = p.toString();
                  return qs ? `/cold-calls?${qs}` : "/cold-calls";
                };
                const seg = "px-3 py-1.5 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center";
                const on = "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700";
                const off = "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50";
                return (
                  <>
                    <Link href={mHref(null)} className={`${seg} ${marketFilter === "all" ? on : off}`}>All Markets</Link>
                    <Link href={mHref("india")} className={`${seg} ${marketFilter === "india" ? on : off}`}>🇮🇳 India Revival</Link>
                    <Link href={mHref("dubai")} className={`${seg} ${marketFilter === "dubai" ? on : off}`}>🇦🇪 Dubai Revival</Link>
                  </>
                );
              })()}
            </div>
          )}

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
                  {/* Fresh / Unstatused chip — the ~45 cold leads with no MIS status yet.
                      Closes the "All ≠ Σ status chips" gap (those leads get no per-status
                      chip). Only shown when there are any in the current filter set. */}
                  {unstatusedCount > 0 && (
                    <Link href={chipHref({ status: statusFilter === FRESH_SENTINEL ? null : FRESH_SENTINEL })} className={`${base} ${statusFilter === FRESH_SENTINEL ? on : off}`}>
                      Fresh <span className={`px-1 rounded text-[10px] ${statusFilter === FRESH_SENTINEL ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{unstatusedCount}</span>
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
            <div className="card p-5 text-center text-gray-500 text-sm">
              No unassigned cold data. Import a batch with the Import button above.
            </div>
          )}

          {/* THE SAME table component as /leads — RevivalLeadsListClient is a thin
              client wrapper around <LeadsListClient> (so the Promote render-fn can
              live client-side). Only the data source + detail link differ, plus the
              Revival-only Promote action rides along via the serializable promoteMeta. */}
          <RevivalLeadsListClient
            canBulk={isAdminOrMgr}
            canReassign={isAdminOrMgr}
            canSetStatus={isAdminOrMgr}
            canDelete={me.isSuperAdmin === true}
            projectOptions={allProjects.map((p) => p.name)}
            statusOptions={statusChips}
            sourceOptions={sourceOptions}
            meRole={me.role}
            showSource={!isAgent}
            searchParamsStr={searchParamsStr}
            agents={agents.map((a) => ({ id: a.id, name: a.name, team: a.team }))}
            leads={listRows}
            promoteMeta={promoteMeta}
          />

          {/* Pagination — EXACTLY the /leads block (Lalit 2026-07-16): Showing X–Y of
              total, Prev / Page N of M / Next. filteredCount is the count of the ACTIVE
              view (same `where` as the grid), so the total tracks search/filters/tabs.
              Spreading `sp` into the links preserves every filter/sort/tab across pages;
              Select-All + bulk actions stay page-scoped because the server only ever
              hands the client this page's 50 rows. */}
          <div className="flex items-center justify-between text-sm">
            <div className="text-gray-500 dark:text-slate-400">
              Showing {filteredCount === 0 ? 0 : skip + 1}–{Math.min(skip + PAGE_SIZE, filteredCount)} of {filteredCount}
            </div>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`?${new URLSearchParams({ ...sp as Record<string, string>, page: String(page - 1) }).toString()}`} className="btn btn-ghost">‹ Prev</Link>
              )}
              <span className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">Page {page} of {Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))}</span>
              {page < Math.ceil(filteredCount / PAGE_SIZE) && (
                <Link href={`?${new URLSearchParams({ ...sp as Record<string, string>, page: String(page + 1) }).toString()}`} className="btn btn-ghost">Next ›</Link>
              )}
            </div>
          </div>
        </div>
    </>
  );
}

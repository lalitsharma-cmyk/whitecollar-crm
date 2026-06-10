import { prisma } from "@/lib/prisma";
import { LeadSource, AIScore, FundReadiness, InvestTimeline, Prisma } from "@prisma/client";
import { formatDistanceToNow, format as fnsFormat } from "date-fns";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import LeadFilters from "@/components/LeadFilters";
import LeadsListClient from "@/components/LeadsListClient";
import { runReconciler } from "@/lib/reconciler";
import { leadScopeWhere } from "@/lib/leadScope";
import { formatBudget } from "@/lib/budgetParse";
import { statusColor, BUDGET_PRESETS, SUPPRESSED_STATUSES, ACTIVE_PURSUIT_STATUSES, CLOSING_STATUSES } from "@/lib/lead-statuses";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const srcChip: Record<LeadSource, string> = {
  WEBSITE: "src-web", WHATSAPP: "src-wa", CSV_IMPORT: "src-csv", EVENT: "src-event",
  REFERRAL: "src", INBOUND_CALL: "src-call", FACEBOOK_ADS: "src-web", GOOGLE_ADS: "src-csv",
  PORTAL_99ACRES: "src", PORTAL_MAGICBRICKS: "src", PORTAL_HOUSING: "src", OTHER: "src",
};
const srcLabel: Record<LeadSource, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook",
  GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing", OTHER: "Other",
};
// Status colors now come from statusColor() in lead-statuses.ts — no stage mapping needed.

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  runReconciler().catch(() => {});
  const sp = await searchParams;

  // View mode — Table is the default (matches Excel workflow); "cards" opt-in.
  const viewMode = (sp.view === "cards" ? "cards" : "table") as "cards" | "table";

  // Build where clause from filters
  // 1. Agents only see leads they own — leadScopeWhere applies the ownerId filter.
  // 2. By default, hide cold-call leads (they live in /cold-calls). User can opt-in
  //    by adding ?showCold=1 to the URL.
  const scope = await leadScopeWhere(me);
  const where: Prisma.LeadWhereInput = sp.showCold === "1"
    ? { ...scope }
    : { ...scope, isColdCall: false };
  // ── Top-level filter tabs: ?filter=all|active|booked|nofollowup ──
  // STATUS-ONLY — no stage system. Tabs filter by currentStatus (Excel status).
  const filterTab = sp.filter ?? "all";
  if (filterTab === "active") {
    // Active — exclude suppressed (dead) statuses
    where.currentStatus = { notIn: SUPPRESSED_STATUSES };
  } else if (filterTab === "booked" || filterTab === "won" || filterTab === "bookings") {
    // Booked with Us (covers old "won" and "bookings" tabs)
    where.currentStatus = "Booked with Us";
  } else if (filterTab === "nofollowup") {
    // Active leads with no follow-up date set
    where.followupDate = null;
    where.currentStatus = { notIn: SUPPRESSED_STATUSES };
  }
  // filterTab === "all" → no currentStatus filter (show everything)

  // Agents: in "all" view, hide clearly-dead leads from their queue by default.
  // An explicit ?cstatus= override lets them see any status if needed.
  if (me.role === "AGENT" && !sp.cstatus && filterTab === "all") {
    where.currentStatus = { notIn: SUPPRESSED_STATUSES };
  }
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { phone: { contains: sp.q } },
      { email: { contains: sp.q, mode: "insensitive" } },
      { company: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  // Agents never see source — they can't filter by it either, even by hand-crafting
  // the ?source= URL. Without this guard an agent could probe the source distribution
  // by setting the param and watching the result count, defeating the privacy policy.
  // source filter is now multi-select — handled below after Excel-field filters
  // Legacy ?status= URL param — redirect to currentStatus filter for backwards compat
  if (sp.status) where.currentStatus = sp.status;
  // ── Excel/MIS status filter (multi-select, comma-separated) ─────────────────
  if (sp.cstatus) {
    const vals = sp.cstatus.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) where.currentStatus = { equals: vals[0], mode: "insensitive" };
    else if (vals.length > 1) where.currentStatus = { in: vals };
  }
  if (sp.ai) where.aiScore = sp.ai as AIScore;
  if (sp.team) where.forwardedTeam = sp.team;
  // Single-value Excel-field filters
  if (sp.potential) where.potential = sp.potential as "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  if (sp.fundReady) where.fundReadiness = sp.fundReady as FundReadiness;
  // Client type — multi-select
  if (sp.clientType) {
    const cts = sp.clientType.split(",").map(s => s.trim()).filter(Boolean) as ("INVESTOR"|"END_USER"|"BOTH"|"UNCLEAR")[];
    if (cts.length === 1) where.clientType = cts[0];
    else if (cts.length > 1) where.clientType = { in: cts };
  }
  // Timeline — multi-select
  if (sp.whenInvest) {
    const wis = sp.whenInvest.split(",").map(s => s.trim()).filter(Boolean) as InvestTimeline[];
    if (wis.length === 1) where.whenCanInvest = wis[0];
    else if (wis.length > 1) where.whenCanInvest = { in: wis };
  }
  if (sp.city) where.city = { contains: sp.city, mode: "insensitive" };
  if (sp.category) where.categorization = { contains: sp.category, mode: "insensitive" };
  // Source filter — multi-select, comma-separated
  if (sp.source && me.role !== "AGENT") {
    const srcs = sp.source.split(",").map(s => s.trim()).filter(Boolean);
    if (srcs.length === 1) where.source = srcs[0] as LeadSource;
    else if (srcs.length > 1) where.source = { in: srcs as LeadSource[] };
  }
  // Project filter — multi-select: match any of the selected projects (OR within project, AND with rest)
  if (sp.project) {
    const projectNames = sp.project.split(",").map(s => s.trim()).filter(Boolean);
    if (projectNames.length > 0) {
      const projectWhere: Prisma.LeadWhereInput = {
        OR: projectNames.flatMap(name => ([
          { discussed: { some: { project: { name: { equals: name } } } } },
          { interestedUnits: { some: { unit: { project: { name: { equals: name } } } } } },
        ])),
      };
      where.AND = where.AND
        ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), projectWhere]
        : [projectWhere];
    }
  }
  // Budget range filter — ?budgetFrom= and ?budgetTo= (raw numbers)
  if (sp.budgetFrom || sp.budgetTo) {
    const bWhere: { gte?: number; lte?: number } = {};
    if (sp.budgetFrom) { const n = parseFloat(sp.budgetFrom); if (!isNaN(n)) bWhere.gte = n; }
    if (sp.budgetTo)   { const n = parseFloat(sp.budgetTo);   if (!isNaN(n)) bWhere.lte = n; }
    if (Object.keys(bWhere).length) where.budgetMin = bWhere;
  }
  // Legacy budget preset (keep backward-compatible)
  if (sp.budgetPreset) {
    const preset = BUDGET_PRESETS.find(b => b.key === sp.budgetPreset);
    if (preset && !sp.budgetFrom) where.budgetMin = { gte: preset.value };
  }
  // Meeting / Site Visit filters
  if (sp.hasMeeting === "1") where.meetingDate = { not: null };
  if (sp.hasSiteVisit === "1") where.siteVisitDate = { not: null };
  // Agents are scoped to their own leads (leadScopeWhere above). Only ADMIN/MANAGER
  // may filter by owner — without this guard an agent could read a peer's leads by
  // hand-crafting ?owner=<id>, overriding their ownership scope.
  if (me.role !== "AGENT") {
    if (sp.owner === "unassigned") where.ownerId = null;
    else if (sp.owner) where.ownerId = sp.owner;
  }
  if (sp.when === "24h") where.createdAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };
  else if (sp.when === "7d") where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
  else if (sp.when === "30d") where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
  else if (sp.when === "overdue") where.lastTouchedAt = { lt: new Date(Date.now() - 5 * 24 * 3600 * 1000) };

  // EOI / booking-funnel filters — driven by the dashboard's EOI Pipeline tiles
  // (admin/manager view). Surfaces leads at specific points in the booking funnel:
  //   active           → anyone with eoiStage set (mid-funnel)
  //   kyc_pending      → KYC docs still outstanding
  //   approval_needed  → eoiApprovalRequired === true (manager sign-off)
  //   stuck            → EOI collected > 7 days ago but booking not yet done
  if (sp.eoi === "active") where.eoiStage = { not: null };
  else if (sp.eoi === "kyc_pending") where.kycStatus = "PENDING";
  else if (sp.eoi === "approval_needed") where.eoiApprovalRequired = true;
  else if (sp.eoi === "stuck") {
    where.bookingDoneAt = null;
    where.eoiCollectedAt = { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000), not: null };
  }

  // Quick filter: ?notPicked=N  → leads where (a) at least one no-answer call
  // has happened in the last N days AND (b) no CONNECTED / INTERESTED call has
  // happened in that window. Lalit asked: "If client is not picking calls from
  // 3 Days, there should be a tag added so filtration can be easy."
  // Allowed values: 2, 3, 5, 7, 14. Anything else → ignored.
  const notPickedDays = sp.notPicked ? parseInt(sp.notPicked) : null;
  if (notPickedDays && [2, 3, 5, 7, 14].includes(notPickedDays)) {
    const sinceMs = Date.now() - notPickedDays * 24 * 3600 * 1000;
    const since = new Date(sinceMs);
    // Subquery via Prisma's some/none filters on the callLogs relation.
    where.callLogs = {
      some: {
        outcome: { in: ["NOT_PICKED", "SWITCHED_OFF", "BUSY"] },
        startedAt: { gte: since },
      },
      none: {
        outcome: { in: ["CONNECTED", "INTERESTED"] },
        startedAt: { gte: since },
      },
    };
  }

  // Quick filter: ?followup=today  → leads whose followupDate falls within today IST.
  // Lalit asked: "Agent is unable to track what are today's follow up... make it
  // filter in leads for agent today's followups."
  // Compute today's IST midnight bounds once — re-used by today/tomorrow chips.
  const istOffsetMs = 330 * 60 * 1000;
  const nowISTBoundary = new Date(Date.now() + istOffsetMs);
  const istMidnight = new Date(nowISTBoundary); istMidnight.setUTCHours(0, 0, 0, 0);
  const istWindow = (offsetDays: number) => {
    const start = new Date(istMidnight); start.setUTCDate(start.getUTCDate() + offsetDays);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    return {
      gte: new Date(start.getTime() - istOffsetMs),
      lt:  new Date(end.getTime()   - istOffsetMs),
    };
  };

  // DEFAULT view = "Today's follow-ups" (Lalit's ask: "By default on leads
  // page Today's follow ups should show"). The agent opens /leads and lands
  // on their priority list for the day. Explicit "show everything" via
  // ?followup=all. Other filters (search, source, owner, etc.) bypass this
  // default — if any non-followup filter is in the URL, treat as a targeted
  // search and show all matching, not just today's.
  // nofollowup filter already sets followupDate: null, so the followup chip
  // default (today) must not compose with it — include it as an "other filter".
  const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.cstatus || sp.owner || sp.team || sp.score || sp.notPicked || sp.eoi || sp.potential || sp.fundReady || sp.clientType || sp.whenInvest || sp.project || sp.budgetPreset || sp.budgetFrom || sp.budgetTo || sp.city || sp.category || sp.hasMeeting || sp.hasSiteVisit || sp.followupFrom || sp.followupTo || filterTab === "nofollowup");
  // §12 Default view by role:
  //   Agent   → Today's Follow-Ups (their primary daily work queue)
  //   Manager → Today's Follow-Ups (recommended, same as agents)
  //   Admin   → All Leads (needs full database visibility)
  // Explicit ?followup= or any other filter in the URL overrides the default.
  if (me.role === "AGENT" || me.role === "MANAGER") {
    if (!hasOtherFilter && !sp.followup) {
      // No filter set → default to today's follow-ups
      where.followupDate = istWindow(0);
    }
  }
  // Admin: no default filter — all leads visible immediately.

  // Excel-style follow-up date range (from filter panel) — takes precedence over quick chips
  if (sp.followupFrom || sp.followupTo) {
    const fRange: { gte?: Date; lte?: Date } = {};
    if (sp.followupFrom) fRange.gte = new Date(sp.followupFrom + "T00:00:00+05:30");
    if (sp.followupTo)   fRange.lte = new Date(sp.followupTo   + "T23:59:59+05:30");
    where.followupDate = fRange;
  }

  // Quick chip-bar shortcuts (Today/Overdue) — ignored if date range is set.
  // ?followup=all explicitly clears the agent's today-default.
  const effectiveFollowup = (sp.followupFrom || sp.followupTo) ? "range" : (sp.followup ?? "all");
  // If agent/manager explicitly chose "all", clear the today filter we set above.
  if (effectiveFollowup === "all" && (me.role === "AGENT" || me.role === "MANAGER")) {
    delete where.followupDate;
  }

  if (effectiveFollowup === "today") {
    // Today in IST as a UTC window: 00:00 IST = 18:30 UTC the previous day.
    where.followupDate = istWindow(0);
  } else if (effectiveFollowup === "tomorrow") {
    // Tomorrow in IST — same window logic, shifted +1 day.
    where.followupDate = istWindow(1);
  } else if (effectiveFollowup === "overdue") {
    // Past-due followups (older than now) — agent missed them.
    where.followupDate = { lt: new Date(), not: null };
  } else if (effectiveFollowup === "week") {
    // Next 7 days from now (inclusive of today).
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
  } else if (effectiveFollowup === "month") {
    // Next 30 days from now (inclusive of today).
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
  }
  // effectiveFollowup === "all" or "range" → followupDate already set above or unset.

  // Smart-filter preset chips — spec §9.3. Composes via AND so it does not
  // replace existing followup / status / source filters. Each preset is a
  // named, opinionated combination of conditions surfaced as a top-row chip.
  const smartAnd: Prisma.LeadWhereInput[] = [];
  if (sp.smart === "hot_today") {
    // 🔥 Hot today — AI flagged HOT and created since midnight IST today.
    smartAnd.push({ aiScore: AIScore.HOT });
    smartAnd.push({ createdAt: { gte: istWindow(0).gte } });
  } else if (sp.smart === "ghosting") {
    // 👻 Ghosting — no touch in 7+ days and still in-pipeline.
    smartAnd.push({ lastTouchedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
    smartAnd.push({ currentStatus: { notIn: SUPPRESSED_STATUSES } });
  } else if (sp.smart === "visit_potential") {
    // 🏢 Site-visit potential — closing statuses (meeting/visit/dubai)
    smartAnd.push({ currentStatus: { in: CLOSING_STATUSES } });
  } else if (sp.smart === "high_budget") {
    // 💎 High budget — ≥ 5M AED or ≥ 3 Cr INR. Currency-aware OR.
    smartAnd.push({
      OR: [
        { budgetCurrency: "AED", budgetMin: { gte: 5_000_000 } },
        { budgetCurrency: "INR", budgetMin: { gte: 30_000_000 } },
      ],
    });
  }
  if (smartAnd.length > 0) {
    where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), ...smartAnd] : smartAnd;
  }

  // Tag filter — composes with the existing AND chain via `contains`. Tags is
  // a comma-separated string column ("NRI,Investor,HNI"), so substring match
  // is good enough; the dropdown options come from a DISTINCT query over the
  // actual data so we never offer a tag nobody has.
  if (sp.tag) {
    const tagFilter: Prisma.LeadWhereInput = { tags: { contains: sp.tag } };
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), tagFilter]
      : [tagFilter];
  }

  // Date range filter
  if (sp.dateFrom || sp.dateTo) {
    const dateField = sp.dateField ?? "followupDate";
    const range: { gte?: Date; lte?: Date } = {};
    if (sp.dateFrom) range.gte = new Date(sp.dateFrom + "T00:00:00+05:30");
    if (sp.dateTo) range.lte = new Date(sp.dateTo + "T23:59:59+05:30");
    if (dateField === "createdAt") where.createdAt = range;
    else if (dateField === "lastTouchedAt") where.lastTouchedAt = range;
    else where.followupDate = range;
  }

  // Sort
  let orderBy: Prisma.LeadOrderByWithRelationInput = { createdAt: "desc" };
  if      (sp.sort === "created_asc")  orderBy = { createdAt: "asc" };
  else if (sp.sort === "score_desc")   orderBy = { aiScoreValue: "desc" };
  else if (sp.sort === "touched_asc")  orderBy = { lastTouchedAt: "asc" };
  else if (sp.sort === "touched_desc") orderBy = { lastTouchedAt: "desc" };
  else if (sp.sort === "name_asc")     orderBy = { name: "asc" };
  else if (sp.sort === "name_desc")    orderBy = { name: "desc" };
  else if (sp.sort === "budget_asc")   orderBy = { budgetMin: "asc" };
  else if (sp.sort === "budget_desc")  orderBy = { budgetMin: "desc" };
  else if (sp.sort === "status_asc")   orderBy = { currentStatus: "asc" };
  else if (sp.sort === "status_desc")  orderBy = { currentStatus: "desc" };
  else if (sp.sort === "followup_asc") orderBy = { followupDate: "asc" };
  else if (sp.sort === "followup_desc")orderBy = { followupDate: "desc" };
  else if (sp.sort === "owner_asc")    orderBy = { owner: { name: "asc" } };
  else if (sp.sort === "owner_desc")   orderBy = { owner: { name: "desc" } };
  // When no explicit sort param is present we'll apply smart priority ordering
  // (NEW → today's follow-up → overdue → others). The flag drives the pre-query below.
  const useSmartSort = !sp.sort;

  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Followup windows for chip counts (scoped to visible leads — agents see
  // their own pipeline, admin sees all). Re-use istWindow() defined above.
  const todayWindow = istWindow(0);
  const activeScope = { ...scope, currentStatus: { notIn: SUPPRESSED_STATUSES } };

  // ── Smart priority sort pre-query ─────────────────────────────────────────
  // When no explicit ?sort= is provided we sort by urgency rather than created-
  // at. Priority tiers: 0=NEW (freshly assigned) → 1=follow-up today → 2=overdue
  // follow-up → 3=everything else. Within each tier, newest-created first.
  // Implemented as a lightweight SELECT (id + 3 fields) over ALL matching rows,
  // sorted in Node.js, then the page slice fed into the full findMany.
  let smartSortPageIds: string[] | null = null;
  let smartSortTotal: number | null = null;

  if (useSmartSort) {
    const now = new Date();
    const priorityRows = await prisma.lead.findMany({
      where,
      select: { id: true, status: true, followupDate: true, createdAt: true },
    });

    const getP = (l: { status: string; followupDate: Date | null }): number => {
      // 0 — freshly assigned (NEW status, never contacted yet)
      if (l.status === "NEW") return 0;
      // 1 — follow-up is due today (IST window)
      if (l.followupDate && l.followupDate >= todayWindow.gte && l.followupDate < todayWindow.lt) return 1;
      // 2 — overdue follow-up (missed deadline)
      if (l.followupDate && l.followupDate < now) return 2;
      // 3 — everything else (future follow-ups, no follow-up set, etc.)
      return 3;
    };

    priorityRows.sort((a, b) => {
      const pa = getP(a), pb = getP(b);
      if (pa !== pb) return pa - pb;
      // Within same tier: newer lead first
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    smartSortTotal = priorityRows.length;
    smartSortPageIds = priorityRows.slice(skip, skip + PAGE_SIZE).map(r => r.id);
  }

  const [leadsRaw, totalFromDb, hot, newToday, totalAll, agents, followupToday, followupOverdue, cstatusCountRows, allTagRows] = await Promise.all([
    smartSortPageIds != null
      ? prisma.lead.findMany({
          where: { id: { in: smartSortPageIds } },
          include: {
            owner: { select: { name: true, avatarColor: true } },
            interestedUnits: { take: 1, select: { unit: { select: { configuration: true, project: { select: { name: true } } } } } },
            discussed: { take: 3, select: { project: { select: { name: true } } } },
            callLogs: { orderBy: { startedAt: "desc" }, take: 20, select: { outcome: true, startedAt: true } },
            activities: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true } },
          },
        })
      : prisma.lead.findMany({
          where, orderBy, skip, take: PAGE_SIZE,
          include: {
            owner: { select: { name: true, avatarColor: true } },
            interestedUnits: { take: 1, select: { unit: { select: { configuration: true, project: { select: { name: true } } } } } },
            discussed: { take: 3, select: { project: { select: { name: true } } } },
            callLogs: { orderBy: { startedAt: "desc" }, take: 20, select: { outcome: true, startedAt: true } },
            activities: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true } },
          },
        }),
    // Skip the count query when we already have the total from the pre-query.
    smartSortTotal != null ? Promise.resolve(smartSortTotal) : prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...scope, aiScore: AIScore.HOT } }),
    prisma.lead.count({ where: { ...scope, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.lead.count({ where: scope }),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } }, orderBy: { name: "asc" } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: todayWindow } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: { lt: new Date(), not: null } } }),
    // Per-currentStatus lead counts for the Excel-status chip bar.
    // Groups by the user-facing currentStatus field so chips reflect real
    // MIS status distribution. Excludes cold-call leads by default.
    prisma.lead.groupBy({
      by: ["currentStatus"],
      where: sp.showCold === "1" ? { ...scope } : { ...scope, isColdCall: false },
      _count: { _all: true },
      orderBy: { _count: { currentStatus: "desc" } },
    }),
    // DISTINCT tag list for the More Filters tag-filter dropdown.
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT TRIM(t) AS tag
      FROM (
        SELECT UNNEST(string_to_array(tags, ',')) AS t
        FROM "Lead"
        WHERE tags IS NOT NULL AND tags <> ''
      ) AS s
      WHERE TRIM(t) <> ''
      ORDER BY tag ASC
    `,
  ]);

  // Re-sort smart-sort results to match the computed priority order.
  // findMany with { id: { in: [...] } } doesn't guarantee insertion order.
  const leads = (() => {
    if (smartSortPageIds == null) return leadsRaw;
    const m = new Map(leadsRaw.map(l => [l.id, l]));
    return smartSortPageIds.map(id => m.get(id)).filter((l): l is NonNullable<typeof l> => l != null);
  })();
  const total = totalFromDb;

  // Per-currentStatus counts — keyed by Excel/MIS status value, sorted by count desc.
  // Only statuses with at least 1 lead are included (groupBy naturally excludes zeros).
  const cstatusCounts: Array<{ label: string; count: number }> = cstatusCountRows
    .filter(r => r.currentStatus != null && r.currentStatus !== "")
    .map(r => ({ label: r.currentStatus as string, count: r._count._all }));
  // Also expose as a map for O(1) lookup
  const cstatusCountMap: Record<string, number> = Object.fromEntries(
    cstatusCounts.map(r => [r.label, r.count])
  );

  const distinctTags: string[] = allTagRows
    .map((r) => r.tag)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  // Projects list for the project filter dropdown — small table, cheap separate query.
  const allProjects = await prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Fetch intelligence match data for the current page of leads (post-join:
  // IntelligenceMatch has no FK back-relation on Lead, so we query separately).
  const leadIds = leads.map((l) => l.id);
  const intelMatches = leadIds.length > 0
    ? await prisma.intelligenceMatch.findMany({
        where: { leadId: { in: leadIds } },
        select: { leadId: true, matchType: true, confidence: true, totalPropertiesFound: true },
      })
    : [];
  const intelByLeadId = new Map(intelMatches.map((m) => [m.leadId, m]));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canBulk = me.role === "ADMIN" || me.role === "MANAGER";

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Leads</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {total < totalAll
              ? <><span className="font-semibold text-[#0b1a33] dark:text-blue-300">{total} filtered</span> · {totalAll} total</>
              : <><span className="font-semibold">{totalAll}</span> total · {newToday} new today · {hot} hot</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.role !== "AGENT" && (
            <Link href="/intake" className="btn btn-ghost flex-1 sm:flex-none justify-center">Import</Link>
          )}
          {me.isSuperAdmin && (
            <Link href="/leads/deleted" className="btn btn-ghost flex-1 sm:flex-none justify-center" title="Deleted leads — Super Admin archive">🗑 Deleted</Link>
          )}
          {me.role !== "AGENT" && (() => {
            const params = new URLSearchParams({ type: "leads" });
            for (const [k, v] of Object.entries(sp)) {
              if (v != null && v !== "") params.set(k, String(v));
            }
            params.set("type", "leads");
            return (
              <a
                href={`/api/reports/export?${params.toString()}`}
                className="btn btn-ghost flex-1 sm:flex-none justify-center"
                title="Export currently filtered leads to CSV"
              >
                ⬇ Export CSV
              </a>
            );
          })()}
          <Link href="/leads/new" className="btn btn-primary flex-1 sm:flex-none justify-center">+ New Lead</Link>
        </div>
      </div>

      {/* ── Search + More Filters ───────────────────────────────────────── */}
      <LeadFilters
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        sources={Object.values(LeadSource)}
        statuses={[]}
        showSource={me.role !== "AGENT"}
        distinctTags={distinctTags}
        projects={allProjects}
      />

      {/* ── Status-based filter chips (Excel/MIS values) ──────────────────── */}
      {(() => {
        const base = "px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 flex-none whitespace-nowrap";
        const chip = (active: boolean, on: string, off: string) => `${base} ${active ? on : off}`;
        const neutral = {
          on:  "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700",
          off: "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600",
        };
        // ── AND-logic chip hrefs ───────────────────────────────────────────
        // Quick chips must REFINE the current result set, never reset it. Each
        // chip preserves every active filter (panel selections, search, other
        // chips) and only patches its own param — so Filter Panel + Quick Chips
        // + Search Bar all combine with AND. Only "Reset All" clears everything.
        const spToParams = () => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(sp)) {
            if (v != null && v !== "" && k !== "page") p.set(k, String(v));
          }
          return p;
        };
        const chipHref = (patch: Record<string, string | null>) => {
          const p = spToParams();
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === "") p.delete(k); else p.set(k, v);
          }
          const qs = p.toString();
          return qs ? `/leads?${qs}` : "/leads";
        };
        const isAgent = me.role === "AGENT" || me.role === "MANAGER";
        // Follow-up time dimension (All / Today / Overdue) writes the `followup`
        // param. Agents have an implicit today-default, so their "All" must set
        // followup=all explicitly to override it; admins just drop the param.
        const followupHref = (val: "today" | "overdue" | "all") =>
          val === "all" ? chipHref({ followup: isAgent ? "all" : null }) : chipHref({ followup: val });

        // §12: For agents/managers the default is Today — so "Today" chip is highlighted
        // when no explicit ?followup= param is set. "All" is highlighted only when ?followup=all.
        const isAgentDefault = isAgent && !sp.followup && !hasOtherFilter;
        const todayChipActive = effectiveFollowup === "today" || isAgentDefault;
        // "All" (follow-up dimension) is active when not narrowed to a specific
        // time window and not on the agent today-default. It can be highlighted
        // alongside an active status chip — they're independent AND filters.
        const allActive = !isAgentDefault && effectiveFollowup === "all";

        return (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
            {/* All — clears only the follow-up time narrowing; preserves panel/search/other chips */}
            <Link
              href={followupHref("all")}
              className={chip(allActive, neutral.on, neutral.off)}>
              All · {totalAll}
            </Link>

            {/* Follow-up time chips — toggle on/off, always preserve other filters */}
            <Link
              href={todayChipActive ? followupHref("all") : followupHref("today")}
              className={chip(todayChipActive, "bg-emerald-600 text-white border-emerald-600", "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-200")}
            >
              📅 Today
              {followupToday > 0 && <span className={`px-1 rounded text-[10px] ${todayChipActive ? "bg-white/25" : "bg-emerald-200/60 dark:bg-emerald-800/60"}`}>{followupToday}</span>}
            </Link>
            <Link
              href={effectiveFollowup === "overdue" ? followupHref("all") : followupHref("overdue")}
              className={chip(effectiveFollowup === "overdue", "bg-red-600 text-white border-red-600", "bg-red-50 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200")}
            >
              ⏰ Overdue
              {followupOverdue > 0 && <span className={`px-1 rounded text-[10px] ${effectiveFollowup === "overdue" ? "bg-white/25" : "bg-red-200/60 dark:bg-red-800/60"}`}>{followupOverdue}</span>}
            </Link>

            {/* Excel/MIS status chips — one per status that has ≥1 lead, sorted by count */}
            {cstatusCounts.map(({ label, count }) => {
              const isActive = sp.cstatus === label;
              // Toggle: clicking the active status removes it; otherwise set it.
              // Either way every OTHER active filter is preserved (AND logic).
              const href = chipHref({ cstatus: isActive ? null : label });
              // Active: filled background; inactive: light tinted background
              const onCls  = "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-600";
              const offCls = `bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600`;
              return (
                <Link key={label} href={href} className={chip(isActive, onCls, offCls)}>
                  {label}
                  <span className={`px-1 rounded text-[10px] ${isActive ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{count}</span>
                </Link>
              );
            })}

            {/* Leadership-only shortcuts */}
            {me.role !== "AGENT" && (
              <>
                <Link href={chipHref({ owner: sp.owner === "unassigned" ? null : "unassigned" })} className={chip(sp.owner === "unassigned", "bg-amber-600 text-white border-amber-600", "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200")}>
                  ⚠ Unassigned
                </Link>
                <Link href={chipHref({ team: sp.team === "Dubai" ? null : "Dubai" })} className={chip(sp.team === "Dubai", "bg-sky-600 text-white border-sky-600", "bg-sky-50 border-sky-300 text-sky-800 dark:bg-sky-950/30 dark:border-sky-700 dark:text-sky-200")}>
                  🇦🇪 Dubai
                </Link>
                <Link href={chipHref({ team: sp.team === "India" ? null : "India" })} className={chip(sp.team === "India", "bg-orange-600 text-white border-orange-600", "bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-200")}>
                  🇮🇳 India
                </Link>
              </>
            )}

            {/* Nav shortcuts */}
            <Link href="/leads/archived" className={`${base} border-[#e5e7eb] dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700`}>🗄️ Archived</Link>
          </div>
        );
      })()}

      {/* ── Active filter banner ────────────────────────────────────────── */}
      {(() => {
        const hasActiveFilters = !!(
          sp.q || sp.source || sp.status || sp.cstatus || sp.owner || sp.team ||
          sp.ai || sp.when || sp.notPicked || sp.eoi || sp.smart ||
          sp.tag || sp.filter || (sp.followup && sp.followup !== "all") ||
          sp.potential || sp.fundReady || sp.clientType || sp.whenInvest ||
          sp.project || sp.budgetPreset || sp.city || sp.category ||
          sp.hasMeeting || sp.hasSiteVisit
        );
        if (!hasActiveFilters) return null;
        return (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              ⚠ Filtered — showing {total} of {totalAll} leads
            </span>
            <Link
              href="/leads"
              className="text-xs text-[#0b1a33] dark:text-blue-300 hover:underline font-medium"
            >
              ✕ Clear all filters
            </Link>
          </div>
        );
      })()}

      {/* ── Result count + view toggle ───────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {total === 1 ? "1 lead" : `${total} leads`}
        </span>
        {/* Table (default) / Card view toggle — table needs no ?view= param */}
        <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-slate-700 rounded-lg p-0.5">
          {([["table","⊞ Table"],["cards","☰ Cards"]] as [string,string][]).map(([v,l]) => {
            const params = new URLSearchParams(Object.entries(sp).filter(([,val]) => val != null && val !== "").map(([k,val]) => [k, String(val!)]));
            // Table is default — no param; Cards = ?view=cards
            if (v === "table") params.delete("view"); else params.set("view", v);
            return (
              <Link key={v} href={`/leads?${params.toString()}`}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${viewMode === v ? "bg-white dark:bg-slate-600 text-gray-900 dark:text-slate-100 shadow-sm" : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"}`}>
                {l}
              </Link>
            );
          })}
        </div>
      </div>

      <LeadsListClient
        canBulk={canBulk}
        canReassign={canBulk}
        canSetStatus={me.role === "ADMIN" || me.role === "MANAGER"}
        canDelete={me.isSuperAdmin === true}
        projectOptions={allProjects.map((p) => p.name)}
        statusOptions={cstatusCounts.map((c) => c.label)}
        meRole={me.role}
        showSource={me.role !== "AGENT"}
        view={viewMode}
        searchParamsStr={new URLSearchParams(Object.entries(sp).filter(([,v]) => v != null && v !== "").map(([k,v]) => [k, String(v!)])).toString()}
        agents={agents.map((a) => ({ id: a.id, name: a.name, team: a.team }))}
        leads={leads.map((l) => {
          const intel = intelByLeadId.get(l.id) ?? null;
          // BANT count: B=budget, A=authority, N=need, T=timeline
          const bantCount = [
            l.budgetMin != null && l.budgetMin > 0,
            l.authorityLevel != null && l.authorityLevel !== "UNKNOWN",
            l.needSummary != null && l.needSummary.trim().length > 0,
            l.whenCanInvest != null && l.whenCanInvest !== "UNKNOWN",
          ].filter(Boolean).length;

          return {
            id: l.id,
            name: l.name,
            phone: l.phone,
            email: l.email,
            source: l.source,
            statusName: l.currentStatus ?? "",
            currentStatus: l.currentStatus ?? null,
            srcChip: srcChip[l.source],
            srcLabel: srcLabel[l.source],
            statusChip: statusColor(l.currentStatus),
            aiScore: l.aiScore,
            aiScoreValue: l.aiScoreValue,
            team: l.forwardedTeam,
            owner: l.owner ? { name: l.owner.name, avatarColor: l.owner.avatarColor ?? "bg-slate-500" } : null,
            // Command Center fields
            budgetFormatted: (() => {
              const fmt = formatBudget(l.budgetMin, l.budgetCurrency);
              if (fmt === "—") return null;
              // INR → ₹ symbol; AED/other → keep currency code
              const prefix = l.budgetCurrency === "INR" ? "₹" : l.budgetCurrency;
              const maxFmt = l.budgetMax ? formatBudget(l.budgetMax, l.budgetCurrency) : null;
              return maxFmt && maxFmt !== fmt ? `${prefix} ${fmt} – ${maxFmt}` : `${prefix} ${fmt}`;
            })(),
            bantCount,
            needSummary: l.needSummary ?? null,
            discussedProjects: l.discussed.map((d) => d.project.name),
            lastTouched: l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: false }) : null,
            lastTouchedAt: l.lastTouchedAt ? l.lastTouchedAt.toISOString() : null,
            todoNext:      l.todoNext ?? null,
            followupDate:  l.followupDate ? fnsFormat(l.followupDate, "dd MMM") : null,
            followupRaw:   l.followupDate ? fnsFormat(l.followupDate, "yyyy-MM-dd") : null,
            city:          l.city ?? null,
            whenCanInvest: l.whenCanInvest ?? null,
            remarks:       l.remarks ? l.remarks.slice(0, 120) : null,
            // Last activity for table "Last Activity" column
            lastActivityType: l.callLogs.length > 0 ? "CALL"
              : l.activities.length > 0 ? l.activities[0].type
              : null,
            lastActivityAt: l.callLogs[0]?.startedAt?.toISOString()
              ?? l.activities[0]?.createdAt?.toISOString()
              ?? null,
            // Connected history for "5C / 2NC" column
            connectedCount: l.callLogs.filter(c => ["CONNECTED","INTERESTED"].includes(c.outcome)).length,
            notPickedCount: l.callLogs.filter(c => ["NOT_PICKED","BUSY","SWITCHED_OFF"].includes(c.outcome)).length,
            intelligenceMatch: intel ? {
              matchType: intel.matchType,
              confidence: intel.confidence,
              totalPropertiesFound: intel.totalPropertiesFound,
            } : null,
            // Legacy fields kept for bulk actions and mobile card
            budget: (() => {
              const fmt = formatBudget(l.budgetMin, l.budgetCurrency);
              if (fmt === "—") return null;
              const prefix = l.budgetCurrency === "INR" ? "₹" : l.budgetCurrency;
              return `${prefix} ${fmt}`;
            })(),
            interest: l.interestedUnits[0] ? `${l.interestedUnits[0].unit.project.name} ${l.interestedUnits[0].unit.configuration}` : null,
            // Project column = the actual property/project name (Excel "Project"
            // column). Imports store that value in sourceDetail. Chain:
            // 1. Formal project link (discussed / interestedUnits)
            // 2. sourceDetail (imported "Project" value, e.g. "Central Park Resorts")
            // 3. notesShort (one-liner requirement sometimes names the project)
            // NEVER fall back to configuration ("2 BHK") — that is its own column.
            projectHint: l.sourceDetail ?? l.notesShort ?? null,
          };
        })}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500 dark:text-slate-400">Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}</div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`?${new URLSearchParams({ ...sp as Record<string,string>, page: String(page - 1) }).toString()}`} className="btn btn-ghost">‹ Prev</Link>
          )}
          <span className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`?${new URLSearchParams({ ...sp as Record<string,string>, page: String(page + 1) }).toString()}`} className="btn btn-ghost">Next ›</Link>
          )}
        </div>
      </div>
    </>
  );
}

import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, AIScore, Prisma } from "@prisma/client";
import { formatDistanceToNow, format as fnsFormat } from "date-fns";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import LeadFilters from "@/components/LeadFilters";
import LeadsListClient from "@/components/LeadsListClient";
import { runReconciler } from "@/lib/reconciler";
import { leadScopeWhere } from "@/lib/leadScope";
import { formatBudget } from "@/lib/budgetParse";

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
const statusChip: Record<LeadStatus, string> = {
  NEW: "chip-new", CONTACTED: "chip-warm", QUALIFIED: "chip-warm", SITE_VISIT: "chip-warm",
  NEGOTIATION: "chip-warm", EOI: "chip-warm", BOOKING_DONE: "chip-won", WON: "chip-won", LOST: "chip-lost",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  runReconciler().catch(() => {});
  const sp = await searchParams;

  // Build where clause from filters
  // 1. Agents only see leads they own — leadScopeWhere applies the ownerId filter.
  // 2. By default, hide cold-call leads (they live in /cold-calls). User can opt-in
  //    by adding ?showCold=1 to the URL.
  const scope = await leadScopeWhere(me);
  const where: Prisma.LeadWhereInput = sp.showCold === "1"
    ? { ...scope }
    : { ...scope, isColdCall: false };
  // ── Top-level pipeline filter tabs: ?filter=all|active|bookings|won|lost ──
  // Applied before the per-role LOST-hide below so explicit tab selections
  // (e.g. ?filter=lost) are respected for ADMIN/MANAGER.
  const filterTab = sp.filter ?? "all";
  if (filterTab === "active") {
    // Active pipeline — exclude closed/booked stages
    where.status = { notIn: [LeadStatus.WON, LeadStatus.LOST, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "bookings") {
    // Booking funnel — EOI or Booking Done
    where.status = { in: [LeadStatus.EOI, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "won") {
    // Won deals — Booking Done or WON
    where.status = { in: [LeadStatus.WON, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "lost") {
    // Lost deals
    where.status = LeadStatus.LOST;
  }
  // filterTab === "all" → no status filter added here (other filters still compose)

  // Quick filter: ?filter=nofollowup → active leads with no follow-up date set.
  // Helps agents and managers surface leads that have slipped through without
  // a scheduled next-touch. Excludes WON/LOST since closed deals don't need
  // follow-ups.
  if (filterTab === "nofollowup") {
    where.followupDate = null;
    where.status = { notIn: [LeadStatus.WON, LeadStatus.LOST] };
  }

  // Agents shouldn't see LOST leads they once owned in their default view —
  // rejected leads disappear from the agent's queue, but ADMIN/MANAGER keep
  // oversight via /admin/rejected-leads and the unfiltered list. An explicit
  // ?status= filter (e.g. ?status=LOST) overrides this hide, so an agent
  // who deliberately navigates "show me my rejected" still sees them.
  if (me.role === "AGENT" && !sp.status && filterTab === "all") {
    where.status = { not: LeadStatus.LOST };
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
  if (sp.source && me.role !== "AGENT") where.source = sp.source as LeadSource;
  if (sp.status) where.status = sp.status as LeadStatus;
  if (sp.ai) where.aiScore = sp.ai as AIScore;
  if (sp.team) where.forwardedTeam = sp.team;
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
  const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.owner || sp.team || sp.score || sp.notPicked || sp.eoi || filterTab === "nofollowup");
  // Default view = ALL leads. No hidden filter is applied on a clean page load.
  // (Previously defaulted to "today" which caused "44 total, 8 matching" confusion.)
  const effectiveFollowup = sp.followup ?? "all";

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
  // effectiveFollowup === "all" → no followupDate filter applied.

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
    smartAnd.push({ status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } });
  } else if (sp.smart === "visit_potential") {
    // 🏢 Site-visit potential — qualified or already scheduled for a visit.
    smartAnd.push({ status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT] } });
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
  if (sp.sort === "created_asc") orderBy = { createdAt: "asc" };
  else if (sp.sort === "score_desc") orderBy = { aiScoreValue: "desc" };
  else if (sp.sort === "touched_asc") orderBy = { lastTouchedAt: "asc" };
  else if (sp.sort === "touched_desc") orderBy = { lastTouchedAt: "desc" };
  else if (sp.sort === "name_asc") orderBy = { name: "asc" };
  // When no explicit sort param is present we'll apply smart priority ordering
  // (NEW → today's follow-up → overdue → others). The flag drives the pre-query below.
  const useSmartSort = !sp.sort;

  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Followup windows for chip counts (scoped to visible leads — agents see
  // their own pipeline, admin sees all). Re-use istWindow() defined above.
  const todayWindow = istWindow(0);
  const activeScope = { ...scope, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } };

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

  const [leadsRaw, totalFromDb, hot, newToday, totalAll, agents, followupToday, followupOverdue, allTagRows] = await Promise.all([
    smartSortPageIds != null
      ? prisma.lead.findMany({
          where: { id: { in: smartSortPageIds } },
          include: {
            owner: { select: { name: true, avatarColor: true } },
            interestedUnits: { take: 1, select: { unit: { select: { configuration: true, project: { select: { name: true } } } } } },
            discussed: { take: 3, select: { project: { select: { name: true } } } },
          },
        })
      : prisma.lead.findMany({
          where, orderBy, skip, take: PAGE_SIZE,
          include: {
            owner: { select: { name: true, avatarColor: true } },
            interestedUnits: { take: 1, select: { unit: { select: { configuration: true, project: { select: { name: true } } } } } },
            discussed: { take: 3, select: { project: { select: { name: true } } } },
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

  const distinctTags: string[] = allTagRows
    .map((r) => r.tag)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

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
            {totalAll} total &middot; {newToday} new today &middot; {hot} hot
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {me.role !== "AGENT" && (
            <Link href="/intake" className="btn btn-ghost flex-1 sm:flex-none justify-center">Import</Link>
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
        statuses={Object.values(LeadStatus)}
        showSource={me.role !== "AGENT"}
        distinctTags={distinctTags}
      />

      {/* ── Quick filter chips ──────────────────────────────────────────── */}
      {(() => {
        const base = "px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 flex-none whitespace-nowrap";
        const chip = (active: boolean, on: string, off: string) => `${base} ${active ? on : off}`;
        const neutral = { on: "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700", off: "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600" };
        const allActive = !sp.followup && !sp.ai && !sp.team && !sp.owner && !sp.smart && !sp.filter && !sp.status;
        return (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
            <Link href="/leads" className={chip(allActive, neutral.on, neutral.off)}>All</Link>
            <Link
              href="/leads?followup=today"
              className={chip(effectiveFollowup === "today" && !sp.ai, "bg-emerald-600 text-white border-emerald-600", "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-200")}
            >
              Today
              {followupToday > 0 && <span className={`px-1 rounded text-[10px] ${effectiveFollowup === "today" ? "bg-white/25" : "bg-emerald-200/60 dark:bg-emerald-800/60"}`}>{followupToday}</span>}
            </Link>
            <Link
              href="/leads?followup=overdue"
              className={chip(effectiveFollowup === "overdue" && !sp.ai, "bg-red-600 text-white border-red-600", "bg-red-50 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200")}
            >
              ⏰ Overdue
              {followupOverdue > 0 && <span className={`px-1 rounded text-[10px] ${effectiveFollowup === "overdue" ? "bg-white/25" : "bg-red-200/60 dark:bg-red-800/60"}`}>{followupOverdue}</span>}
            </Link>
            <Link
              href="/leads?ai=HOT"
              className={chip(sp.ai === "HOT", "bg-orange-600 text-white border-orange-600", "bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-200")}
            >
              🔥 Hot
              {hot > 0 && <span className={`px-1 rounded text-[10px] ${sp.ai === "HOT" ? "bg-white/25" : "bg-orange-200/60 dark:bg-orange-800/60"}`}>{hot}</span>}
            </Link>
            <Link
              href="/leads?status=SITE_VISIT"
              className={chip(sp.status === "SITE_VISIT", "bg-teal-600 text-white border-teal-600", "bg-teal-50 border-teal-300 text-teal-800 dark:bg-teal-950/30 dark:border-teal-700 dark:text-teal-200")}
            >
              🏠 Site Visit
            </Link>
            <Link
              href="/leads?status=NEGOTIATION"
              className={chip(sp.status === "NEGOTIATION", "bg-indigo-600 text-white border-indigo-600", "bg-indigo-50 border-indigo-300 text-indigo-800 dark:bg-indigo-950/30 dark:border-indigo-700 dark:text-indigo-200")}
            >
              💼 Negotiation
            </Link>
            {me.role !== "AGENT" && (
              <>
                <Link href="/leads?owner=unassigned" className={chip(sp.owner === "unassigned", "bg-amber-600 text-white border-amber-600", "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-200")}>
                  ⚠ Unassigned
                </Link>
                <Link href="/leads?team=Dubai" className={chip(sp.team === "Dubai", "bg-blue-600 text-white border-blue-600", "bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200")}>
                  Dubai
                </Link>
                <Link href="/leads?team=India" className={chip(sp.team === "India", "bg-purple-600 text-white border-purple-600", "bg-purple-50 border-purple-300 text-purple-800 dark:bg-purple-950/30 dark:border-purple-700 dark:text-purple-200")}>
                  India
                </Link>
              </>
            )}
            {/* Nav shortcuts */}
            <Link href="/leads/kanban" className={`${base} border-[#e5e7eb] dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700`}>📋 Pipeline</Link>
            <Link href="/leads/archived" className={`${base} border-[#e5e7eb] dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700`}>🗄️ Archived</Link>
          </div>
        );
      })()}

      {/* ── Active filter banner ────────────────────────────────────────── */}
      {(() => {
        const hasActiveFilters = !!(
          sp.q || sp.source || sp.status || sp.owner || sp.team ||
          sp.ai || sp.when || sp.notPicked || sp.eoi || sp.smart ||
          sp.tag || sp.filter || (sp.followup && sp.followup !== "all")
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

      {/* ── Result count ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end">
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {total === 1 ? "1 lead" : `${total} leads`}
        </span>
      </div>

      <LeadsListClient
        canBulk={canBulk}
        canReassign={canBulk}
        canSetStatus={me.role === "ADMIN" || me.role === "MANAGER"}
        showSource={me.role !== "AGENT"}
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
            statusName: l.status,
            srcChip: srcChip[l.source],
            srcLabel: srcLabel[l.source],
            statusChip: statusChip[l.status],
            aiScore: l.aiScore,
            aiScoreValue: l.aiScoreValue,
            team: l.forwardedTeam,
            owner: l.owner ? { name: l.owner.name, avatarColor: l.owner.avatarColor ?? "bg-slate-500" } : null,
            // Command Center fields
            budgetFormatted: formatBudget(l.budgetMin, l.budgetCurrency) !== "—"
              ? `${l.budgetCurrency} ${formatBudget(l.budgetMin, l.budgetCurrency)}`
              : null,
            bantCount,
            needSummary: l.needSummary ?? null,
            discussedProjects: l.discussed.map((d) => d.project.name),
            lastTouched: l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: false }) : null,
            lastTouchedAt: l.lastTouchedAt ? l.lastTouchedAt.toISOString() : null,
            todoNext: l.todoNext ?? null,
            followupDate: l.followupDate ? fnsFormat(l.followupDate, "dd MMM") : null,
            intelligenceMatch: intel ? {
              matchType: intel.matchType,
              confidence: intel.confidence,
              totalPropertiesFound: intel.totalPropertiesFound,
            } : null,
            // Legacy fields kept for bulk actions and mobile card
            budget: formatBudget(l.budgetMin, l.budgetCurrency) !== "—"
              ? `${l.budgetCurrency} ${formatBudget(l.budgetMin, l.budgetCurrency)}`
              : null,
            interest: l.interestedUnits[0] ? `${l.interestedUnits[0].unit.project.name} ${l.interestedUnits[0].unit.configuration}` : null,
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

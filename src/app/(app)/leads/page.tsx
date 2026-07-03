import { prisma } from "@/lib/prisma";
import { LeadSource, AIScore, FundReadiness, InvestTimeline, Prisma } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import LeadFilters from "@/components/LeadFilters";
import LeadsListClient from "@/components/LeadsListClient";
import MotivationBanner from "@/components/MotivationBanner";
import { runReconciler } from "@/lib/reconciler";
import { leadScopeWhere, COLD_ORIGINS, workableWhere, activeBoardWhere, MASTER_DATA_BOARD_OR } from "@/lib/leadScope";
import { canExportData, canImportData } from "@/lib/exportPerms";
import { overdueFollowupBoundary } from "@/lib/datetime";
import { contactActivityByLeadToday } from "@/lib/followupGate";
import { CONTACT_ACTIVITY_TYPES } from "@/lib/dashboardWidgets";
import {
  freshTodayWhere, freshUntouchedWhere, assignedTodayWhere, firstContactPendingWhere,
  assignedTodayOr, FIRST_CONTACT_PENDING_WHERE, FRESH_STATUS_OR, isAssignedToday,
} from "@/lib/freshLeads";
import { projectWhereForUser } from "@/lib/propertyScope";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { displayBudget } from "@/lib/budgetParse";
import { getAvailableMediums } from "@/lib/mediumManager";
import { formatLeadName } from "@/lib/leadName";
import { statusColor, BUDGET_PRESETS, SUPPRESSED_STATUSES, ACTIVE_PURSUIT_STATUSES, CLOSING_STATUSES, TERMINAL_STATUSES, CLOSED_OUTCOME_STATUSES, LOST_STATUSES, leadSortTier, compareStatusDisplay } from "@/lib/lead-statuses";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const srcChip: Record<LeadSource, string> = {
  WEBSITE: "src-web", WCR_WEBSITE: "src-web", WCR_EVENT: "src-event", LANDING_PAGE: "src-web",
  WHATSAPP: "src-wa", CSV_IMPORT: "src-csv", EVENT: "src-event",
  REFERRAL: "src", INBOUND_CALL: "src-call", FACEBOOK_ADS: "src-web", GOOGLE_ADS: "src-csv",
  PORTAL_99ACRES: "src", PORTAL_MAGICBRICKS: "src", PORTAL_HOUSING: "src", OTHER: "src",
};
const srcLabel: Record<LeadSource, string> = {
  WEBSITE: "Website", WCR_WEBSITE: "Website", WCR_EVENT: "WCR Event", LANDING_PAGE: "Landing Page",
  WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV Import", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Call", FACEBOOK_ADS: "Facebook Ads",
  GOOGLE_ADS: "Google Ads", PORTAL_99ACRES: "Portal 99acres", PORTAL_MAGICBRICKS: "Portal MagicBricks",
  PORTAL_HOUSING: "Portal Housing", OTHER: "Other",
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
    : { ...scope, isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS } };
  // ── Working Leads view = WORKABLE ONLY ──────────────────────────────────
  // The normal Leads screen shows only ACTIONABLE leads. Both LOST/rejected
  // statuses (Broker, War Fear, Not Interested, …) AND closed outcomes (Booked
  // With Us, Sell Out, Leasing, …) are TERMINAL — they leave the working view
  // and live in Master Data. Source of truth: TERMINAL_STATUSES (driven by the
  // Reject-modal reasons). `?filter=closed|lost` are explicit peek views; an
  // explicit ?cstatus= further down can still look up any single status.
  const filterTab = sp.filter ?? "all";
  if (filterTab === "closed" || filterTab === "booked" || filterTab === "won" || filterTab === "bookings") {
    where.currentStatus = { in: CLOSED_OUTCOME_STATUSES };
  } else if (filterTab === "lost" || filterTab === "rejected") {
    where.currentStatus = { in: LOST_STATUSES };
  } else {
    if (filterTab === "nofollowup") where.followupDate = null;
    // all / active / nofollowup → WORKABLE ONLY. SQL `NOT IN` evaluates to NULL
    // (not true) for rows where currentStatus IS NULL, so a plain notIn would
    // silently HIDE unclassified leads — which are FRESH and the most important
    // to chase. OR the null/blank statuses back in. Skipped when an explicit
    // ?cstatus=/?status= lookup is active (those set where.currentStatus below).
    if (!sp.cstatus && !sp.status) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] },
      ];
    }
  }

  // ── Top-level segment selector (admin/manager): My / India / Dubai / All ──
  // Default = My Leads, so Lalit/admins open to their OWN pipeline, not the
  // whole company. Agents are already restricted to their own leads by
  // leadScopeWhere, so the selector is admin/manager-only. The advanced
  // ?owner= / ?team= filters further down still refine/override this.
  // ADMIN-only. Managers stay team-scoped via leadScopeWhere (they must NOT be
  // able to pivot to another team's leads), and agents already see only their
  // own. So the My/India/Dubai/All selector is for Lalit/admins.
  const isAdmin = me.role === "ADMIN";
  // Lead-Ops / Support-Admin (Sameer): a lead MANAGER, not a sales agent — owns no
  // leads, so "My Leads" is meaningless. No "mine" segment; default to All Leads.
  const isLeadOps = (me as { leadOpsOnly?: boolean }).leadOpsOnly === true;
  const seg = isLeadOps
    ? (sp.seg === "india" || sp.seg === "dubai" ? sp.seg : "all")
    : isAdmin ? (sp.seg ?? "mine") : "all";
  const segWhere: Prisma.LeadWhereInput = {};
  if (isAdmin) {
    if (seg === "mine") segWhere.ownerId = me.id;
    else if (seg === "india") segWhere.forwardedTeam = "India";
    else if (seg === "dubai") segWhere.forwardedTeam = "Dubai";
    // seg === "all" → no segment restriction
  }
  Object.assign(where, segWhere);
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { phone: { contains: sp.q } },
      { email: { contains: sp.q, mode: "insensitive" } },
      { company: { contains: sp.q, mode: "insensitive" } },
      // Property enquired lives in sourceDetail for imported cold leads — search it
      // too, so "Whiteland" finds them (matches leadFilterWhere on /cold-calls).
      { sourceDetail: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  // Agents never see source — they can't filter by it either, even by hand-crafting
  // the ?source= URL. Without this guard an agent could probe the source distribution
  // by setting the param and watching the result count, defeating the privacy policy.
  // source filter is now multi-select — handled below after Excel-field filters
  // Legacy ?status= URL param — redirect to currentStatus filter for backwards compat
  if (sp.status) where.currentStatus = sp.status;
  // Helper: split a comma-separated multi-select param ("a,b,c") into trimmed values.
  const splitMulti = (raw: string | undefined) =>
    (raw ?? "").split(",").map(s => s.trim()).filter(Boolean);
  // ── Excel/MIS status filter (multi-select, comma-separated) ─────────────────
  if (sp.cstatus) {
    const vals = sp.cstatus.split(",").map(s => s.trim()).filter(Boolean);
    if (vals.length === 1) where.currentStatus = { equals: vals[0], mode: "insensitive" };
    else if (vals.length > 1) where.currentStatus = { in: vals };
  }
  if (sp.ai) where.aiScore = sp.ai as AIScore;
  // ── "Untouched" filter (?untouched=1) — reproduces the Dashboard "Hot Leads
  // Untouched" widget drill: leads with ZERO meaningful contact logged (no
  // CallLog, no contact-type Activity). Same UNTOUCHED_WHERE the dashboard count
  // uses, so the card number == the rows that open here (count == drill).
  if (sp.untouched === "1") {
    where.callLogs = { none: {} };
    where.activities = { none: { type: { in: CONTACT_ACTIVITY_TYPES } } };
  }
  // ── Fresh-lead filters (?fresh=today|assigned|untouched|pending) ────────────
  // Today's freshly-assigned leads must never get lost among old follow-ups
  // (Lalit, 2026-07-01). All four lenses key off the SINGLE source of truth in
  // freshLeads.ts so the chip count == the rows that open here == the badge on
  // the row == the escalation cron. Composed via AND so they layer on top of the
  // scope + workable envelope without clobbering the search OR. Each is treated
  // as an "other filter" below, so it turns OFF the default follow-up narrowing.
  const freshAnd: Prisma.LeadWhereInput[] = [];
  if (sp.fresh === "today") {
    // Fresh Today — assigned today (IST) AND still a fresh/uncontacted status.
    freshAnd.push(assignedTodayOr(), { OR: FRESH_STATUS_OR });
  } else if (sp.fresh === "assigned") {
    // Assigned Today — landed in this agent's queue today, any status.
    freshAnd.push(assignedTodayOr());
  } else if (sp.fresh === "untouched") {
    // Fresh Untouched — assigned today AND no first contact logged yet.
    freshAnd.push(assignedTodayOr(), FIRST_CONTACT_PENDING_WHERE);
  } else if (sp.fresh === "pending") {
    // First Contact Pending — any assigned workable lead never contacted (any day).
    freshAnd.push({ ownerId: { not: null } }, FIRST_CONTACT_PENDING_WHERE);
  }
  if (freshAnd.length > 0) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      ...freshAnd,
    ];
  }
  // Team filter — now multi-select (comma-separated) so the Excel "Team" column
  // header filter can tick India + Dubai together. Single value stays a plain
  // equals (keeps the legacy Dubai/India quick-chips + filter-panel working).
  if (sp.team) {
    const teams = splitMulti(sp.team);
    if (teams.length === 1) where.forwardedTeam = teams[0];
    else if (teams.length > 1) where.forwardedTeam = { in: teams };
  }
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
  // Property type — multi-select (Residential / Commercial / Mixed Use). Not
  // source-sensitive, so every role may filter (agents stay scoped to own leads).
  if (sp.propertyType) {
    const pts = sp.propertyType.split(",").map(s => s.trim()).filter(Boolean);
    if (pts.length === 1) where.propertyType = pts[0];
    else if (pts.length > 1) where.propertyType = { in: pts };
  }
  // Source filter — multi-select, comma-separated. Filters on the verbatim
  // sourceRaw field (human values like "WhatsApp", "Google Ads"), not the
  // legacy `source` enum. Dropdown options are the DISTINCT sourceRaw values.
  if (sp.source && me.role !== "AGENT") {
    const srcs = sp.source.split(",").map(s => s.trim()).filter(Boolean);
    if (srcs.length === 1) where.sourceRaw = srcs[0];
    else if (srcs.length > 1) where.sourceRaw = { in: srcs };
  }
  // Project filter — multi-select: match any of the selected projects (OR within project, AND with rest)
  if (sp.project) {
    const projectNames = sp.project.split(",").map(s => s.trim()).filter(Boolean);
    if (projectNames.length > 0) {
      const projectWhere: Prisma.LeadWhereInput = {
        OR: projectNames.flatMap(name => ([
          { discussed: { some: { project: { name: { equals: name } } } } },
          { interestedUnits: { some: { unit: { project: { name: { equals: name } } } } } },
          // Imported cold leads store the enquired property in sourceDetail only (no
          // formal Project relation) — match it too, or "Whiteland Westin Residences"
          // returns 0 here while /cold-calls (leadFilterWhere) correctly finds 228.
          { sourceDetail: { contains: name, mode: "insensitive" } },
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
  // Currency-review filter — ?ccy=unknown surfaces leads whose budget currency
  // couldn't be resolved (need admin review / Recalculate Currency).
  if (sp.ccy === "unknown") where.budgetCurrency = "UNKNOWN";
  // Legacy budget preset (keep backward-compatible)
  if (sp.budgetPreset) {
    const preset = BUDGET_PRESETS.find(b => b.key === sp.budgetPreset);
    if (preset && !sp.budgetFrom) where.budgetMin = { gte: preset.value };
  }
  // Meeting / Site Visit filters
  if (sp.hasMeeting === "1") where.meetingDate = { not: null };
  if (sp.hasSiteVisit === "1") where.siteVisitDate = { not: null };
  // Manager-escalation drill — the dashboard "Needs Lalit" count links here
  // (?owner=<agent>&needs=1) to show that agent's open escalations.
  if (sp.needs === "1") where.needsManagerReview = true;
  // Agents are scoped to their own leads (leadScopeWhere above). Only ADMIN/MANAGER
  // may filter by owner — without this guard an agent could read a peer's leads by
  // hand-crafting ?owner=<id>, overriding their ownership scope.
  if (me.role !== "AGENT") {
    // Owner filter — multi-select (comma-separated) so the Excel "Assigned"
    // column header can tick several agents at once. "unassigned" stays a
    // special sentinel (ownerId = null); it may also be mixed with real owner
    // ids (e.g. "unassigned,<id>") → match those owners OR no-owner.
    const owners = splitMulti(sp.owner);
    const wantsUnassigned = owners.includes("unassigned");
    const ownerIds = owners.filter(o => o !== "unassigned");
    if (wantsUnassigned && ownerIds.length > 0) {
      // Mix of "unassigned" + specific owners → AND-in an OR clause so it never
      // clobbers the search OR (sp.q also writes where.OR).
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        // "unassigned" = ready-to-assign → EXCLUDE rejected (hard-unassigned but not
        // a normal unassigned lead; rejectedAt is the source of truth).
        { OR: [{ ownerId: null, rejectedAt: null }, { ownerId: { in: ownerIds } }] },
      ];
    } else if (wantsUnassigned) {
      where.ownerId = null;
      where.rejectedAt = null; // rejected leads are never "ready to assign"
    } else if (ownerIds.length === 1) {
      where.ownerId = ownerIds[0];
    } else if (ownerIds.length > 1) {
      where.ownerId = { in: ownerIds };
    }
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
  const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.cstatus || sp.owner || sp.team || sp.score || sp.ai || sp.untouched || sp.fresh || sp.when || sp.notPicked || sp.eoi || sp.smart || sp.potential || sp.fundReady || sp.clientType || sp.whenInvest || sp.project || sp.propertyType || sp.budgetPreset || sp.budgetFrom || sp.budgetTo || sp.city || sp.category || sp.hasMeeting || sp.hasSiteVisit || sp.needs || sp.followupFrom || sp.followupTo || filterTab === "nofollowup");
  // ── DEFAULT working view = ALL workable leads (6-tier smart sorted) ─────
  // Updated rule (Lalit, 2026-06-21): show EVERY workable lead by default,
  // ordered by the 6-tier smart sort so today's fresh leads + today's follow-ups
  // stay on top and future / no-follow-up leads sink to the bottom (never hidden).
  // Explicit chips (Today / Overdue / Future / No Follow-up) still narrow on demand.
  const endOfTodayUTC = istWindow(0).lt;  // start of tomorrow IST, as a UTC instant
  // "Needs action TODAY" = a follow-up due today/overdue OR a lead assigned today
  // that the agent hasn't contacted yet (Lalit, 2026-07-01). Fresh leads assigned
  // today often have no follow-up date (bulk-assign) or a future one, so the plain
  // Today+Overdue window used to HIDE them — the exact "fresh leads get lost" bug.
  // This one fragment backs BOTH the default list rows AND the "Today+Overdue" chip
  // count, so count == drill still holds. (Applied only to the "todue" view.)
  const todueOrFresh: Prisma.LeadWhereInput = {
    OR: [
      { followupDate: { lt: endOfTodayUTC, not: null } },
      { AND: [assignedTodayOr(), FIRST_CONTACT_PENDING_WHERE] },
    ],
  };
  let effectiveFollowup: string;
  if (sp.followupFrom || sp.followupTo) effectiveFollowup = "range";
  else if (sp.followup) effectiveFollowup = sp.followup;        // explicit chip
  else if (filterTab === "nofollowup") effectiveFollowup = "none";
  else if (hasOtherFilter) effectiveFollowup = "all";          // targeted search → no time narrowing
  // DEFAULT (Lalit, 2026-06-22): open straight to "Today + Overdue" — the leads
  // that need action NOW (today's follow-ups + every overdue one), still ordered
  // by the 6-tier smart sort within that set. Applies to EVERY role. Future /
  // no-follow-up leads are one chip away ("All Active" / "Future"). The "🎯 Today
  // + Overdue" chip auto-highlights since it keys off effectiveFollowup.
  else effectiveFollowup = "todue";                            // ← the default

  if (effectiveFollowup === "range") {
    const fRange: { gte?: Date; lte?: Date } = {};
    if (sp.followupFrom) fRange.gte = new Date(sp.followupFrom + "T00:00:00+05:30");
    if (sp.followupTo)   fRange.lte = new Date(sp.followupTo   + "T23:59:59+05:30");
    where.followupDate = fRange;
  } else if (effectiveFollowup === "today") {
    where.followupDate = istWindow(0);
  } else if (effectiveFollowup === "tomorrow") {
    where.followupDate = istWindow(1);
  } else if (effectiveFollowup === "overdue") {
    // Overdue = strictly before the start of today IST (a follow-up due LATER
    // today is "Today", not overdue). Canonical boundary so Today/Overdue are
    // disjoint and the count matches the Dashboard tile + Action List.
    where.followupDate = { lt: overdueFollowupBoundary(), not: null };
  } else if (effectiveFollowup === "todue") {
    // Today + Overdue + today's fresh-untouched. Added under AND (not a direct
    // followupDate assignment) so a fresh lead with NO follow-up date still shows.
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      todueOrFresh,
    ];
  } else if (effectiveFollowup === "future") {
    // Tomorrow (IST) onward.
    where.followupDate = { gte: endOfTodayUTC };
  } else if (effectiveFollowup === "none") {
    where.followupDate = null;
  } else if (effectiveFollowup === "week") {
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
  } else if (effectiveFollowup === "month") {
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
  }
  // effectiveFollowup === "all" → no follow-up filter (every workable lead).

  // ── Active-Board MASTER_DATA gate on the follow-up LIST (chip == list rows) ──
  // When a board-style follow-up window is active (Today / Overdue / Today+Overdue
  // / Future / Tomorrow / week / month — all imply a non-null followupDate), the
  // LIST rows must obey the SAME Active-Board envelope the chip COUNTS use, so a
  // MASTER_DATA lead surfaces only when assigned (the chip already excludes the
  // unassigned ones via boardScope). Without this, an unassigned Master-Data lead
  // with a follow-up would show in the list but not be counted in the chip. The
  // "none" / "all" / "range" views are intentionally the broad workable pipeline,
  // so we skip the gate there. (Today: 0 such leads exist, so this is a durable
  // no-op guard against future imports rather than a behaviour change.)
  const BOARD_FOLLOWUP_WINDOWS = ["today", "tomorrow", "overdue", "todue", "future", "week", "month"];
  if (BOARD_FOLLOWUP_WINDOWS.includes(effectiveFollowup)) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { OR: MASTER_DATA_BOARD_OR },   // shared with activeBoardWhere (single source)
    ];
  }

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
  // Single source of truth for "active workable" — same envelope the Dashboard
  // follow-up tiles use, so the chip counts reconcile 1:1 (incl. cold/revival
  // exclusion that was previously missing here). Used for the NON-board chips
  // (No Follow-up, All Active) which describe the broad workable pipeline.
  const activeScope = workableWhere({ ...scope, ...segWhere });
  // ACTIVE FOLLOW-UP BOARD envelope — the chips that mirror the Action List
  // (Today+Overdue / Today / Overdue / Future) MUST count through the SAME
  // activeBoardWhere the board uses, so the Action-List ⇄ Leads-chip
  // reconciliation holds. vs activeScope it ADDS the Jun26 Master-Data gate
  // (a MASTER_DATA lead counts only when assigned AND scheduled). For these
  // follow-up-date chips followupDate is always non-null, so the gate reduces
  // to "exclude unassigned Master-Data" — exactly the board's new behaviour.
  const boardScope = activeBoardWhere({ ...scope, ...segWhere });

  // ── Smart priority sort pre-query ─────────────────────────────────────────
  // When no explicit ?sort= is provided we sort by urgency rather than created-
  // at. Priority tiers: 0=NEW (freshly assigned) → 1=follow-up today → 2=overdue
  // follow-up → 3=everything else. Within each tier, newest-created first.
  // Implemented as a lightweight SELECT (id + 3 fields) over ALL matching rows,
  // sorted in Node.js, then the page slice fed into the full findMany.
  let smartSortPageIds: string[] | null = null;
  let smartSortTotal: number | null = null;

  if (useSmartSort) {
    // Fresh-untouched-today ids within the CURRENT filter scope — the tier-0 pin.
    // Single source of truth (freshLeads.freshUntouchedWhere) so the sort, the
    // badge, the count widget, and the escalation cron all agree on "fresh untouched".
    const [priorityRows, fuRows] = await Promise.all([
      prisma.lead.findMany({
        where,
        // currentStatus drives the "fresh" test (the `status` enum is vestigial).
        select: { id: true, currentStatus: true, followupDate: true, createdAt: true },
      }),
      prisma.lead.findMany({ where: freshUntouchedWhere(where), select: { id: true } }),
    ]);
    const fuSet = new Set(fuRows.map(r => r.id));

    // 7-tier default order (tier-0 added 2026-07-01): today's fresh UNTOUCHED →
    // today's fresh → today's follow-ups → old fresh → overdue → future → other.
    // Today's new leads never get buried; the untouched ones sit at the very top.
    priorityRows.sort((a, b) => {
      const pa = leadSortTier(a, todayWindow, fuSet.has(a.id));
      const pb = leadSortTier(b, todayWindow, fuSet.has(b.id));
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
    prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER", "ADMIN"] } }, orderBy: { name: "asc" } }),
    prisma.lead.count({ where: { ...boardScope, followupDate: todayWindow } }),
    // Overdue chip BADGE — must use the same canonical boundary as the chip's
    // filter (start of today IST) so badge count == rows shown when clicked.
    prisma.lead.count({ where: { ...boardScope, followupDate: { lt: overdueFollowupBoundary(), not: null } } }),
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

  // Counts for the follow-up chips (segment-scoped, workable). Today+Overdue is
  // the true UNION (not today+overdue summed — they overlap on earlier-today);
  // allWorkable backs the "All Active" chip so it matches the segment, not 160.
  const [followupTodue, followupFuture, followupNone, allWorkable,
    freshUntouchedCount, freshTodayCount, assignedTodayCount, firstContactPendingCount] = await Promise.all([
    // "Today+Overdue" chip — widened to the SAME union the default list uses
    // (follow-ups due today/overdue OR today's fresh-untouched), so count == drill
    // still holds now that fresh leads with no follow-up date surface in this view.
    prisma.lead.count({ where: {
      ...boardScope,
      AND: [
        ...(Array.isArray(boardScope.AND) ? boardScope.AND : boardScope.AND ? [boardScope.AND] : []),
        todueOrFresh,
      ],
    } }),
    prisma.lead.count({ where: { ...boardScope, followupDate: { gte: endOfTodayUTC } } }),
    // Non-board chips (No Follow-up, All Active) describe the broad workable pipeline.
    prisma.lead.count({ where: { ...activeScope, followupDate: null } }),
    prisma.lead.count({ where: activeScope }),
    // ── Fresh-lead widgets + chips (single source of truth: freshLeads.ts) ──────
    prisma.lead.count({ where: freshUntouchedWhere(activeScope) }),   // ⚡ Untouched Fresh
    prisma.lead.count({ where: freshTodayWhere(activeScope) }),        // 🆕 Fresh Today
    prisma.lead.count({ where: assignedTodayWhere(activeScope) }),     // Assigned Today
    prisma.lead.count({ where: firstContactPendingWhere(activeScope) }), // First Contact Pending
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
    .map(r => ({ label: r.currentStatus as string, count: r._count._all }))
    // The working view's status chip-bar offers ONLY workable statuses — terminal
    // ones (Broker, War Fear, Booked With Us, …) belong to Master Data, not the
    // agent's working screen. When the user explicitly peeks at a closed/lost
    // view, show that bucket's chips instead.
    .filter(r =>
      (filterTab === "closed" || filterTab === "booked" || filterTab === "won" || filterTab === "bookings")
        ? CLOSED_OUTCOME_STATUSES.includes(r.label)
        : (filterTab === "lost" || filterTab === "rejected")
          ? LOST_STATUSES.includes(r.label)
          : !TERMINAL_STATUSES.includes(r.label))
    // Canonical display order (Fresh Lead → Office Visit → Follow Up → Visit Dubai
    // → Details Shared → rest A→Z) instead of count-desc. Display-only.
    .sort((a, b) => compareStatusDisplay(a.label, b.label));
  // Also expose as a map for O(1) lookup
  const cstatusCountMap: Record<string, number> = Object.fromEntries(
    cstatusCounts.map(r => [r.label, r.count])
  );

  const distinctTags: string[] = allTagRows
    .map((r) => r.tag)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

  // Projects list for the project filter dropdown — small table, cheap separate query.
  // Market-scoped: an agent only sees their own market's projects in the filter
  // (admins/managers see all).
  const allProjects = await prisma.project.findMany({
    where: projectWhereForUser(me),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Source filter options — DISTINCT verbatim sourceRaw values actually present
  // in the DB. The source dropdown now reads/filters on sourceRaw (human values
  // like "WhatsApp", "Google Ads"), not the legacy `source` enum. Corrupted
  // leads with sourceRaw=null are excluded so we never offer a blank option.
  const sourceRows = await prisma.lead.findMany({
    where: { deletedAt: null, sourceRaw: { not: null } },
    distinct: ["sourceRaw"],
    select: { sourceRaw: true },
    orderBy: { sourceRaw: "asc" },
  });
  const sourceOptions = sourceRows.map(r => r.sourceRaw!).filter(Boolean);

  // Medium filter options — standard channels (Call/WhatsApp/Email) + any custom
  // mediums seen on leads + "Other". Same list the New-Lead form uses, so the
  // filter offers exactly what can be set. leadFilterWhere translates ?medium=.
  const mediumOptions = await getAvailableMediums();

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

  // Contact-today flags for the Complete-button gate (one batch query over the
  // current page). hasContactToday(leadId) → Complete enabled; else disabled +
  // "Contact attempt required" tooltip. Agent must log a touch before completing.
  const contactTodaySet = leadIds.length > 0
    ? await contactActivityByLeadToday(leadIds)
    : new Set<string>();

  // "Untouched" (first-contact-pending) flags for the current page — one batch
  // query over the SAME FIRST_CONTACT_PENDING_WHERE the counts/sort/cron use, so a
  // row's ⚡ badge is exact. Drives the NEW TODAY / Untouched badge + row highlight.
  const untouchedSet = leadIds.length > 0
    ? new Set((await prisma.lead.findMany({
        where: { id: { in: leadIds }, ...FIRST_CONTACT_PENDING_WHERE },
        select: { id: true },
      })).map((l) => l.id))
    : new Set<string>();

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
          {/* Fresh-lead count widgets — always visible so no agent misses today's
              newly assigned leads. Click to drill into the matching filter. */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Link href={`/leads?fresh=today`} className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-200">
              🆕 Fresh Leads Today <span className="tabular-nums">{freshTodayCount}</span>
            </Link>
            <Link href={`/leads?fresh=untouched`} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${freshUntouchedCount > 0 ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200 animate-pulse" : "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
              ⚡ Untouched Fresh <span className="tabular-nums">{freshUntouchedCount}</span>
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canImportData(me) && (
            <Link href="/intake" className="btn btn-ghost flex-1 sm:flex-none justify-center">Import</Link>
          )}
          {me.isSuperAdmin && (
            <Link href="/leads/deleted" className="btn btn-ghost flex-1 sm:flex-none justify-center" title="Deleted leads — Super Admin archive">🗑 Deleted</Link>
          )}
          {canExportData(me) && (() => {
            const params = new URLSearchParams({ type: "leads" });
            for (const [k, v] of Object.entries(sp)) {
              if (v != null && v !== "") params.set(k, String(v));
            }
            params.set("type", "leads");
            return (
              <>
                <a
                  href={`/api/reports/export?${params.toString()}`}
                  className="btn btn-ghost flex-1 sm:flex-none justify-center"
                  title="Export currently filtered leads to CSV"
                >
                  ⬇ Export CSV
                </a>
                <a
                  href={`/api/reports/export?${params.toString()}&format=xlsx`}
                  className="btn btn-ghost flex-1 sm:flex-none justify-center"
                  title="Export currently filtered leads to Excel"
                >
                  ⬇ Excel
                </a>
              </>
            );
          })()}
          {me.role !== "AGENT" && (
            <Link href="/leads/new" className="btn btn-primary flex-1 sm:flex-none justify-center">+ New Lead</Link>
          )}
        </div>
      </div>

      {/* ── Motivational banner (presentational, Leads-page only) ─────────────
          Sits ABOVE the filters/table. Personalised with the logged-in user's
          first name; rotates every 7s. Isolated client island — no impact on
          the table/filters below. */}
      <MotivationBanner firstName={(me.name ?? "").split(" ")[0]} team={me.team ?? null} />

      {/* ── Segment selector: My / India / Dubai / All (admin only) ───────── */}
      {isAdmin && (() => {
        const SEGS: { key: string; label: string }[] = [
          ...(isLeadOps ? [] : [{ key: "mine", label: "My Leads" }]),
          { key: "india", label: "India Team" },
          { key: "dubai", label: "Dubai Team" },
          { key: "all",   label: "All Leads" },
        ];
        const segHref = (key: string) => {
          const p = new URLSearchParams();
          for (const [k, v] of Object.entries(sp)) {
            if (v != null && v !== "" && k !== "page" && k !== "seg") p.set(k, String(v));
          }
          const defaultSeg = isLeadOps ? "all" : "mine"; // default seg keeps the URL clean
          if (key !== defaultSeg) p.set("seg", key);
          const qs = p.toString();
          return `/leads${qs ? `?${qs}` : ""}`;
        };
        return (
          <div className="flex flex-wrap gap-2">
            {SEGS.map((s) => {
              const active = seg === s.key;
              return (
                <Link
                  key={s.key}
                  href={segHref(s.key)}
                  className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold border min-h-9 inline-flex items-center transition-colors ${
                    active
                      ? "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700"
                      : "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-600"
                  }`}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        );
      })()}

      {/* ── Search + More Filters ───────────────────────────────────────── */}
      <LeadFilters
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        sources={sourceOptions}
        statuses={[]}
        showSource={me.role !== "AGENT"}
        distinctTags={distinctTags}
        projects={allProjects}
        mediums={mediumOptions}
        propertyTypes={PROPERTY_TYPES}
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
        // Follow-up dimension chips. Each chip applies its filter via an EXPLICIT
        // ?followup= param, so EVERY chip always navigates + re-filters — including
        // the default "All Active" (previously a dead link because the old default
        // was "todue"/no-param). Clicking the already-active chip returns to "All
        // Active". The DEFAULT view (no param) equals "all". Every OTHER active
        // filter (status, search, panel) is preserved (AND logic).
        const fupHref = (val: string) => chipHref({ followup: val });
        const fc = (val: string, active: boolean, label: string, count: number | null, on: string, off: string) => (
          <Link href={active && val !== "all" ? fupHref("all") : fupHref(val)} className={chip(active, on, off)}>
            {label}
            {count != null && count > 0 && <span className={`px-1 rounded text-[10px] ${active ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{count}</span>}
          </Link>
        );
        // Fresh-lead chips (Lalit, 2026-07-01) — the four lenses on today's newly
        // assigned leads. Clicking a fresh chip clears any follow-up narrowing (it's
        // an "other filter"), and toggles off when clicked again. Warm colours so
        // they stand apart from the cool follow-up chips.
        const fr = (val: string, label: string, count: number, on: string, off: string) => (
          <Link href={chipHref({ fresh: sp.fresh === val ? null : val, followup: null })} className={chip(sp.fresh === val, on, off)}>
            {label}
            {count > 0 && <span className={`px-1 rounded text-[10px] ${sp.fresh === val ? "bg-white/25" : "bg-black/10 dark:bg-white/10"}`}>{count}</span>}
          </Link>
        );

        return (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
            {fr("untouched", "⚡ Fresh Untouched", freshUntouchedCount, "bg-red-600 text-white border-red-600", "bg-red-50 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200")}
            {fr("today", "🆕 Fresh Today", freshTodayCount, "bg-amber-500 text-white border-amber-500", "bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/30 dark:border-amber-600 dark:text-amber-200")}
            {fr("assigned", "📥 Assigned Today", assignedTodayCount, "bg-blue-600 text-white border-blue-600", "bg-blue-50 border-blue-300 text-blue-800 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-200")}
            {fr("pending", "☎ First Contact Pending", firstContactPendingCount, "bg-orange-600 text-white border-orange-600", "bg-orange-50 border-orange-300 text-orange-800 dark:bg-orange-950/30 dark:border-orange-700 dark:text-orange-200")}
            <span className="w-px self-stretch bg-gray-200 dark:bg-slate-600 shrink-0" aria-hidden />
            {fc("todue", effectiveFollowup === "todue", "🎯 Today + Overdue", followupTodue, "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700", neutral.off)}
            {fc("today", effectiveFollowup === "today", "📅 Today", followupToday, "bg-emerald-600 text-white border-emerald-600", "bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-200")}
            {fc("overdue", effectiveFollowup === "overdue", "⏰ Overdue", followupOverdue, "bg-red-600 text-white border-red-600", "bg-red-50 border-red-300 text-red-800 dark:bg-red-950/30 dark:border-red-700 dark:text-red-200")}
            {fc("future", effectiveFollowup === "future", "🔮 Future", followupFuture, "bg-violet-600 text-white border-violet-600", "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-950/30 dark:border-violet-700 dark:text-violet-200")}
            {fc("none", effectiveFollowup === "none", "🚫 No Follow-up", followupNone, "bg-slate-600 text-white border-slate-600", "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-200")}
            {fc("all", effectiveFollowup === "all", "All Active", allWorkable, neutral.on, neutral.off)}

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

            {/* Nav shortcuts — Archived = rejected leads, NON-AGENT only (agents must
                never see rejected leads; they live in Master Data for admin review). */}
            {me.role !== "AGENT" && (
              <Link href="/leads/archived" className={`${base} border-[#e5e7eb] dark:border-slate-600 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700`}>🗄️ Archived</Link>
            )}
          </div>
        );
      })()}

      {/* ── Active filter banner ────────────────────────────────────────── */}
      {(() => {
        const hasActiveFilters = !!(
          sp.q || sp.source || sp.status || sp.cstatus || sp.owner || sp.team ||
          sp.ai || sp.untouched || sp.when || sp.notPicked || sp.eoi || sp.smart ||
          sp.tag || sp.filter || (sp.followup && sp.followup !== "all") ||
          sp.potential || sp.fundReady || sp.clientType || sp.whenInvest ||
          sp.project || sp.propertyType || sp.budgetPreset || sp.city || sp.category ||
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
        sourceOptions={sourceOptions}
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
            name: formatLeadName(l.name),
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
            // TEAM-AWARE budget (Lalit's rule): India → ₹ Lakh/Cr, Dubai → AED K/M.
            // displayBudget() handles the verbatim-raw vs numeric + team currency.
            budgetFormatted: (() => { const d = displayBudget(l); return d === "—" ? null : d; })(),
            bantCount,
            needSummary: l.needSummary ?? null,
            discussedProjects: l.discussed.map((d) => d.project.name),
            lastTouched: l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: false }) : null,
            lastTouchedAt: l.lastTouchedAt ? l.lastTouchedAt.toISOString() : null,
            todoNext:      l.todoNext ?? null,
            // IST-rendered (not server-UTC). An IST-midnight follow-up instant
            // (e.g. 25 Jun 00:00 IST = 24 Jun 18:30Z) was rendering as the PRIOR
            // day under date-fns' UTC format ("24 Jun"). en-IN → display label,
            // en-CA → the canonical YYYY-MM-DD the date-input + snooze prefill use.
            followupDate:  l.followupDate ? new Date(l.followupDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : null,
            followupRaw:   l.followupDate ? new Date(l.followupDate).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null,
            // Enquiry date — when the client came in. Imports set createdAt from the
            // sheet's Date column; manually-created leads get the creation date.
            enquiryDate:   l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit" }) : null,
            enquiryTime:   l.createdAt ? new Date(l.createdAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true }) : null,
            enquiryRaw:    l.createdAt ? new Date(l.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : null,
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
            hasContactToday: contactTodaySet.has(l.id),
            // Fresh-lead visibility flags (Lalit, 2026-07-01) — drive the NEW TODAY
            // / Untouched badge + row highlight. assignedToday from assignedAt (or
            // createdAt fallback); untouched from the batch FIRST_CONTACT_PENDING set.
            assignedToday: isAssignedToday({ assignedAt: l.assignedAt, createdAt: l.createdAt }),
            untouched: untouchedSet.has(l.id),
            freshUntouchedToday: isAssignedToday({ assignedAt: l.assignedAt, createdAt: l.createdAt }) && untouchedSet.has(l.id),
            intelligenceMatch: intel ? {
              matchType: intel.matchType,
              confidence: intel.confidence,
              totalPropertiesFound: intel.totalPropertiesFound,
            } : null,
            // Legacy fields kept for bulk actions and mobile card — team-aware too.
            budget: (() => { const d = displayBudget(l); return d === "—" ? null : d; })(),
            interest: l.interestedUnits[0] ? `${l.interestedUnits[0].unit.project.name} ${l.interestedUnits[0].unit.configuration}` : null,
            // Property Enquired column = the CANONICAL `sourceDetail` field, the
            // SAME value the lead-detail view and Master Data grid show. We pass
            // sourceDetail and notesShort SEPARATELY (not pre-merged) so the
            // table's resolver can always honor sourceDetail verbatim — even a
            // free-text property not in the Project Master ("Central Park Valley")
            // — while still gating the weak notesShort remark behind a known-
            // project match. This keeps detail / table / Master Data in agreement.
            // NEVER fall back to configuration ("2 BHK") — that is its own column.
            sourceDetail: l.sourceDetail ?? null,
            projectHint: l.notesShort ?? null,
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

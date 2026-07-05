// ────────────────────────────────────────────────────────────────────────────
// AGENT LEAD PERFORMANCE ENGINE
//
// Single source of truth for the /reports/agent-performance module. Computes a
// typed per-agent metric object that is:
//   • DATE-WINDOW aware   — the OUTCOME / activity metrics respect an IST
//     day-boundary range (calls, meetings, rejected/closed/lost-in-window).
//   • CURRENT-OWNER based for the "Leads Assigned" group — counts by the lead's
//     CURRENT owner (ownerId), NOT assignment history. A lead reassigned
//     Tanuj→Yasir immediately stops counting for Tanuj and counts for Yasir, so
//     the report reconciles with global search / the Leads list / lead detail /
//     export. (A lead the agent owned that is now rejected-and-unassigned is
//     still attributed to them via previousOwnerId.) This group is a point-in-
//     time snapshot, so it is intentionally NOT date-windowed.
//   • DELETED / archived EXCLUDED everywhere (lead.deletedAt: null). A
//     soft-deleted (recycle-bin / rolled-back-import) lead never counts.
//   • RECONCILABLE — every count has a matching drill-down query in
//     drilldownWhere() so "N records" on screen == N in the CRM list.
//
// FUTURE-READY: buildAgentReport() returns AgentMetrics[] — a flat, typed,
// composable object per agent. New metric groups (Revenue, Brokerage, Booking
// Value, Collection, Incentive) are ADDITIVE: add fields to AgentMetrics +
// a compute branch; nothing downstream needs a redesign.
//
// Rejected leads STILL COUNT (they are part of an agent's handled volume) — they
// are attributed via previousOwnerId once reject nulls the owner, and outcome
// metrics report rejected/closed/lost as their own columns.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import { Prisma, CallOutcome, ActivityType, LeadSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  CLOSED_OUTCOME_STATUSES,
  LOST_STATUSES,
  TERMINAL_STATUSES,
  isFreshStatus,
  isWorkableStatus,
  leadStatusColumn,
  COLUMN_STATUS_VALUES,
  COLUMN_NON_OPEN_STATUSES,
  FRESH_STATUS_IN_VALUES,
} from "@/lib/lead-statuses";
import { ACTIVE_ORIGIN_WHERE } from "@/lib/leadScope";
import { isActivePipelineRow } from "@/lib/freshLeads";
import { leadSourceModule, LEAD_SOURCE_MODULES } from "@/lib/moduleSource";
import type { SourceModule } from "@/lib/moduleSource";

// Typed enum arrays for Prisma `in` filters (string-backed enums; we keep them
// as proper enum arrays so the queries are type-checked). Connected = picked up;
// not-picked = the unsuccessful-call set. Mirrors src/lib/callOutcome.ts sets.
const CONNECTED_CALL_OUTCOMES: CallOutcome[] = [
  CallOutcome.CONNECTED, CallOutcome.INTERESTED, CallOutcome.NOT_INTERESTED,
];
const NOT_PICKED_CALL_OUTCOMES: CallOutcome[] = [
  CallOutcome.NOT_PICKED, CallOutcome.BUSY, CallOutcome.SWITCHED_OFF, CallOutcome.WRONG_NUMBER, CallOutcome.CALLBACK,
];
// Meeting activity types — OFFICE/VIRTUAL/EXPO/HOME + legacy MEETING. Nothing dropped.
const MEETING_ACTIVITY_TYPES: ActivityType[] = [
  ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.EXPO_MEETING,
  ActivityType.HOME_VISIT, ActivityType.MEETING,
];
// Source enum buckets for assignment-source attribution.
//
// IMPORTANT (prod enum drift): the Prisma SCHEMA lists WCR_WEBSITE / WCR_EVENT /
// LANDING_PAGE, but those values are NOT present in the live Postgres LeadSource
// enum (that migration was never applied to prod). Passing a non-existent enum
// member to a Prisma `in` filter throws 22P02 at query time. So any value used
// in a DB `in` filter (drill-down, COUNT) MUST be restricted to the prod-valid
// members below. The wider "intended" labels are matched JS-side instead (see
// WEBSITE_SOURCE_LABELS / EVENT_SOURCE_LABELS) so a future-migrated WCR_* value
// still buckets correctly without crashing today.
const WEBSITE_SOURCE_ENUMS: LeadSource[] = [LeadSource.WEBSITE];
const EVENT_SOURCE_ENUMS: LeadSource[] = [LeadSource.EVENT];
// JS-side string buckets (safe — never reaches the DB enum). Catches the
// not-yet-migrated WCR_* values defensively for the in-memory classification.
const WEBSITE_SOURCE_LABELS = new Set(["WEBSITE", "WCR_WEBSITE", "LANDING_PAGE"]);
const EVENT_SOURCE_LABELS = new Set(["WCR_EVENT", "EVENT"]);

// ── Date windows (IST day boundaries) ────────────────────────────────────────
// Vercel runs in UTC; the team thinks in IST. All presets snap to IST midnight
// so "Today" / "This Month" match what agents see on their phones. Mirrors the
// IST-window math used in /api/reports/export and /reports/activity.

const IST_OFFSET_MS = 330 * 60 * 1000; // +05:30

export type RangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "thisMonth"
  | "lastMonth"
  | "last3Months"
  | "last6Months"
  | "thisYear"
  | "custom";

export interface DateRange {
  /** inclusive lower bound (UTC instant of an IST midnight) */
  gte: Date;
  /** exclusive upper bound (UTC instant of an IST midnight) */
  lt: Date;
  preset: RangePreset;
  label: string;
}

/** IST "now" shifted into a UTC clock so getUTC* reads IST wall-clock fields. */
function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** UTC instant for IST-midnight of the IST calendar day `offsetDays` from today. */
function istMidnightUTC(offsetDays: number): Date {
  const n = istNow();
  const istMid = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offsetDays, 0, 0, 0, 0);
  return new Date(istMid - IST_OFFSET_MS);
}

/** UTC instant for IST-midnight of the 1st of the IST month `monthOffset` away. */
function istMonthStartUTC(monthOffset: number): Date {
  const n = istNow();
  const istMid = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + monthOffset, 1, 0, 0, 0, 0);
  return new Date(istMid - IST_OFFSET_MS);
}

/** UTC instant for IST-midnight Jan 1 of the current IST year. */
function istYearStartUTC(): Date {
  const n = istNow();
  const istMid = Date.UTC(n.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
  return new Date(istMid - IST_OFFSET_MS);
}

/** Parse a YYYY-MM-DD string as an IST-midnight UTC instant. Null on bad input. */
function parseISTDate(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const istMid = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(istMid - IST_OFFSET_MS);
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 Days",
  thisMonth: "This Month",
  lastMonth: "Last Month",
  last3Months: "Last 3 Months",
  last6Months: "Last 6 Months",
  thisYear: "This Year",
  custom: "Custom Range",
};

/**
 * Resolve a date range from query params. `preset` is one of RangePreset;
 * `from`/`to` (YYYY-MM-DD, IST) are used only when preset === "custom".
 * Defaults to "thisMonth" when nothing valid is supplied.
 */
export function resolveDateRange(
  preset: string | undefined,
  from?: string,
  to?: string,
): DateRange {
  const tomorrowMid = istMidnightUTC(1); // exclusive end-of-today
  switch (preset) {
    case "today":
      return { gte: istMidnightUTC(0), lt: tomorrowMid, preset: "today", label: PRESET_LABELS.today };
    case "yesterday":
      return { gte: istMidnightUTC(-1), lt: istMidnightUTC(0), preset: "yesterday", label: PRESET_LABELS.yesterday };
    case "last7":
      return { gte: istMidnightUTC(-6), lt: tomorrowMid, preset: "last7", label: PRESET_LABELS.last7 };
    case "lastMonth":
      return { gte: istMonthStartUTC(-1), lt: istMonthStartUTC(0), preset: "lastMonth", label: PRESET_LABELS.lastMonth };
    case "last3Months":
      return { gte: istMonthStartUTC(-2), lt: tomorrowMid, preset: "last3Months", label: PRESET_LABELS.last3Months };
    case "last6Months":
      return { gte: istMonthStartUTC(-5), lt: tomorrowMid, preset: "last6Months", label: PRESET_LABELS.last6Months };
    case "thisYear":
      return { gte: istYearStartUTC(), lt: tomorrowMid, preset: "thisYear", label: PRESET_LABELS.thisYear };
    case "custom": {
      const g = parseISTDate(from) ?? istMonthStartUTC(0);
      // `to` is inclusive on the UI → add a day for the exclusive upper bound.
      const tParsed = parseISTDate(to);
      const l = tParsed ? new Date(tParsed.getTime() + 24 * 3600 * 1000) : tomorrowMid;
      return { gte: g, lt: l, preset: "custom", label: PRESET_LABELS.custom };
    }
    case "thisMonth":
    default:
      return { gte: istMonthStartUTC(0), lt: tomorrowMid, preset: "thisMonth", label: PRESET_LABELS.thisMonth };
  }
}

/** Range preset options for the UI selector (order matters). */
export const RANGE_OPTIONS: Array<{ value: RangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "last3Months", label: "Last 3 Months" },
  { value: "last6Months", label: "Last 6 Months" },
  { value: "thisYear", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

// ── Scope ────────────────────────────────────────────────────────────────────

export interface ReportScope {
  /** ADMIN sees all teams; MANAGER is locked to their team; AGENT to self. */
  role: "ADMIN" | "MANAGER" | "AGENT";
  /** Self id — used to restrict an AGENT to their own row. */
  meId: string;
  /** "India" | "Dubai" | null — when set, restricts agents + team scope. */
  team?: string | null;
}

export interface AgentLite {
  id: string;
  name: string;
  team: string | null;
  role: string;
}

/**
 * The set of active, non-HR agents this report should show, honoring scope.
 *   ADMIN   → all active non-HR AGENT/MANAGER, optionally filtered to one team.
 *   MANAGER → active non-HR AGENT/MANAGER on the manager's team only.
 *   AGENT   → just themselves.
 */
export async function scopedAgents(scope: ReportScope): Promise<AgentLite[]> {
  if (scope.role === "AGENT") {
    const u = await prisma.user.findUnique({
      where: { id: scope.meId },
      select: { id: true, name: true, team: true, role: true },
    });
    return u ? [u] : [];
  }
  const where: Prisma.UserWhereInput = {
    role: { in: ["AGENT", "MANAGER"] },
    active: true,
    hrOnly: false,
  };
  // MANAGER: forced to own team. ADMIN: optional team filter.
  const teamFilter = scope.role === "MANAGER" ? scope.team : scope.team ?? undefined;
  if (teamFilter === "India" || teamFilter === "Dubai") where.team = teamFilter;
  return prisma.user.findMany({
    where,
    select: { id: true, name: true, team: true, role: true },
    orderBy: { name: "asc" },
  });
}

// ── Metric shape ─────────────────────────────────────────────────────────────
// One flat typed object per agent. Adding a future metric = add a field here +
// populate it in buildAgentReport(). Drill-down keys map 1:1 to drilldownWhere().

// ── Module bifurcation (Lalit 2026-07-06) ────────────────────────────────────
// Every LEAD-derived metric is additionally split across the 3 lead-origin
// modules — Leads · Master Data · Revival Engine — via the CANONICAL resolver
// leadSourceModule(leadOrigin, isColdCall). The split is an ADDITIVE structure on
// top of the existing flat totals: for a bifurcated metric X, the invariant
//   X === moduleSplit.X["Leads"] + moduleSplit.X["Master Data"] + moduleSplit.X["Revival Engine"]
// holds by construction (each source row is classified once, into exactly one
// module). A tiny runtime assertion (assertSplitsSumToTotals) verifies it.
//
// Buyer modules (Dubai / India Buyer Data) are NOT part of this split — buyers
// are a SEPARATE parallel report (buyerPerformance.ts). We never invent lead
// metrics (Fresh / Follow-up) for buyers.

/** A per-lead-module tally: Leads · Master Data · Revival Engine. */
export type ModuleTriple = Record<SourceModule, number>;

/** The lead metrics that carry a module breakdown. Keep in sync with
 *  buildModuleSplit()'s populated fields + MODULE_SPLIT_METRICS below. */
export interface ModuleSplit {
  totalAssigned: ModuleTriple;
  freshAssigned: ModuleTriple;
  stillActive: ModuleTriple;
  closedWon: ModuleTriple;
  lost: ModuleTriple;
  rejected: ModuleTriple;
  curBooked: ModuleTriple;
  callsLogged: ModuleTriple;
  notesAdded: ModuleTriple;
  whatsappConversations: ModuleTriple;
  meetingsScheduled: ModuleTriple;
  siteVisitsScheduled: ModuleTriple;
}

/** An empty {Leads:0, Master Data:0, Revival Engine:0} triple (only the 3 lead
 *  modules — buyers are excluded from the split by design). */
function zeroTriple(): ModuleTriple {
  return { "Leads": 0, "Master Data": 0, "Revival Engine": 0, "Dubai Buyer Data": 0, "India Buyer Data": 0 };
}
function zeroSplit(): ModuleSplit {
  return {
    totalAssigned: zeroTriple(), freshAssigned: zeroTriple(), stillActive: zeroTriple(),
    closedWon: zeroTriple(), lost: zeroTriple(), rejected: zeroTriple(), curBooked: zeroTriple(),
    callsLogged: zeroTriple(), notesAdded: zeroTriple(), whatsappConversations: zeroTriple(),
    meetingsScheduled: zeroTriple(), siteVisitsScheduled: zeroTriple(),
  };
}

/** The metric keys that have a module split (drives the UI expandable rows +
 *  the total==sum assertion). Each names a numeric AgentMetrics field AND a
 *  ModuleSplit field. */
export const MODULE_SPLIT_METRICS: Array<keyof ModuleSplit & keyof AgentMetrics> = [
  "totalAssigned", "freshAssigned", "stillActive", "closedWon", "lost", "rejected",
  "curBooked", "callsLogged", "notesAdded", "whatsappConversations",
  "meetingsScheduled", "siteVisitsScheduled",
];

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  team: string | null;

  /**
   * Per-lead-module breakdown of the bifurcated metrics (see ModuleSplit).
   * ADDITIVE — the flat totals below are unchanged; this is a parallel view so
   * total === Leads + Master Data + Revival for each covered metric.
   */
  moduleSplit: ModuleSplit;

  // ── Lead Assignment (by ASSIGNMENT HISTORY in window) ──
  totalAssigned: number;
  freshAssigned: number;
  websiteAssigned: number;
  eventAssigned: number;
  revivalAssigned: number;
  buyerAssigned: number; // BuyerRecord uses free-text agentName (no User FK) → always 0 (see note)

  // ── CURRENT-STATUS breakdown of the leads ASSIGNED-IN-WINDOW (admin
  // dashboard "Live Lead Assignment" grid). Buckets are DISJOINT
  // (leadStatusColumn) so cur* sum to totalAssigned. "Where are the leads
  // this agent received in the window RIGHT NOW?" — distinct from the
  // owner-book Outcomes group below. rejected (rejectedAt-in-window) is the
  // existing owner-scoped column and is reported alongside.
  curFresh: number;
  curContacted: number;
  curQualified: number;
  curMeeting: number;
  curSiteVisit: number;
  curNegotiation: number;
  curBooked: number;
  curLost: number;
  curOther: number;
  /** Assigned-in-window AND currently still workable (not terminal). */
  assignedActive: number;
  /**
   * Of the assigned-in-window cohort, how many are CURRENTLY rejected
   * (rejectedAt != null). This is the SAME-COHORT rejected number — distinct
   * from `rejected` below, which is the owner-scoped count of ALL rejections
   * dated in the window (a different, non-comparable population). Every
   * rejection RATE must use this cohort number as its numerator so the rate is
   * always 0–100% (a lead can't be rejected-from-cohort more than once).
   */
  curRejected: number;

  // ── Lead Outcomes (current owner, status-bucketed; rejected by rejectedAt in window) ──
  rejected: number;
  closedWon: number;
  lost: number;
  stillActive: number;
  awaitingFollowup: number; // followupDate today/overdue, still active
  noFollowup: number; // followupDate null, still active

  // ── Engagement (Activity / CallLog / Note in window, by userId) ──
  callsLogged: number;
  connectedCalls: number;
  notPickedCalls: number;
  whatsappConversations: number;
  notesAdded: number;
  voiceNotesAdded: number;

  // ── Meetings (Activity, by userId, in window) ──
  meetingsScheduled: number;
  meetingsCompleted: number;
  officeMeetings: number;
  virtualMeetings: number;

  // ── Site visits (Activity SITE_VISIT, by userId, in window) ──
  siteVisitsScheduled: number;
  siteVisitsCompleted: number;
  siteVisitsCancelled: number;

  // ── Conversion funnel (per agent) ──
  funnelAssigned: number;
  funnelQualified: number;
  funnelMeetings: number;
  funnelSiteVisits: number;
  funnelNegotiations: number;
  funnelBookings: number;
}

/** Empty metrics for an agent — the additive baseline. */
function zeroMetrics(a: AgentLite): AgentMetrics {
  return {
    agentId: a.id,
    agentName: a.name,
    team: a.team,
    moduleSplit: zeroSplit(),
    totalAssigned: 0, freshAssigned: 0, websiteAssigned: 0, eventAssigned: 0, revivalAssigned: 0, buyerAssigned: 0,
    curFresh: 0, curContacted: 0, curQualified: 0, curMeeting: 0, curSiteVisit: 0, curNegotiation: 0, curBooked: 0, curLost: 0, curOther: 0, assignedActive: 0, curRejected: 0,
    rejected: 0, closedWon: 0, lost: 0, stillActive: 0, awaitingFollowup: 0, noFollowup: 0,
    callsLogged: 0, connectedCalls: 0, notPickedCalls: 0, whatsappConversations: 0, notesAdded: 0, voiceNotesAdded: 0,
    meetingsScheduled: 0, meetingsCompleted: 0, officeMeetings: 0, virtualMeetings: 0,
    siteVisitsScheduled: 0, siteVisitsCompleted: 0, siteVisitsCancelled: 0,
    funnelAssigned: 0, funnelQualified: 0, funnelMeetings: 0, funnelSiteVisits: 0, funnelNegotiations: 0, funnelBookings: 0,
  };
}

// ── Status / source classification helpers (shared with drill-down) ──────────

const REVIVAL_ORIGINS = ["REVIVAL", "COLD"]; // legacy + canonical

// Funnel stage status sets (status-only; the CRM has no stage system).
// QUALIFIED+ = any lead that reached a meeting/visit/negotiation/booking stage.
const MEETING_STATUSES = [
  "Meeting", "Wants Office Visit", "Want Office Visit", "Zoom Meeting", "Visit Dubai", "Expo Only",
];
const SITE_VISIT_STATUSES = ["Site Visit Schedule", "Visit Dubai"];
const NEGOTIATION_STATUSES = ["Details Shared", "Mail Sent"]; // closest "in discussion" proxy
const BOOKING_STATUSES = ["Booked With Us", "Booked with Us"];

// ── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build the full per-agent metric set for a date range + scope. One aggregated
 * object per scoped agent. All queries exclude deleted leads and honor the
 * window. Returns rows in the agent's name order (stable for the table).
 */
export async function buildAgentReport(range: DateRange, scope: ReportScope): Promise<AgentMetrics[]> {
  const agents = await scopedAgents(scope);
  if (agents.length === 0) return [];
  const agentIds = agents.map((a) => a.id);
  const byId = new Map(agents.map((a) => [a.id, zeroMetrics(a)]));

  const win = { gte: range.gte, lt: range.lt };

  // ── 1. CURRENT-OWNER book (the attribution backbone) ──
  // "Leads Assigned" reflects CURRENT ownership — the agent who owns the lead
  // NOW — so a reassigned lead immediately moves to the new owner and the metric
  // reconciles 1:1 with global search, the Leads list (owner filter), the lead
  // detail page, and export. (Lalit's rule: "Total Leads Assigned" is a CURRENT
  // metric, NOT assignment history. A lead reassigned Tanuj→Yasir stops counting
  // for Tanuj and counts for Yasir — it must never linger under the old owner.)
  //
  // Rejected leads STILL COUNT for the agent who handled them: reject nulls
  // ownerId but preserves previousOwnerId, so we attribute (ownerId ?? previous-
  // OwnerId). This keeps the rejection-rate numerator (curRejected) meaningful —
  // same (ownerId OR null+previousOwnerId) shape the `rejected`/`lost` drills use.
  //
  // No date window: the current book is a point-in-time fact, not a windowed
  // event — the OUTCOMES section below stays windowed. deletedAt:null drops
  // recycle-bin records. isColdCall NOT filtered — full holding; revival/cold
  // are reported as their own column.
  const ownedRows = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      OR: [
        { ownerId: { in: agentIds } },
        { ownerId: null, previousOwnerId: { in: agentIds } },
      ],
    },
    select: {
      ownerId: true,
      previousOwnerId: true,
      currentStatus: true,
      source: true,
      sourceRaw: true,
      leadOrigin: true,
      importBatchId: true,
      isColdCall: true,
      rejectedAt: true,
    },
  });

  for (const l of ownedRows) {
    const aid = l.ownerId ?? l.previousOwnerId; // current owner, or handler of a now-unassigned rejected lead
    if (!aid) continue;
    const m = byId.get(aid);
    if (!m) continue;
    // Canonical module for this lead row — the ONE classifier every surface uses.
    const mod = leadSourceModule(l.leadOrigin, l.isColdCall);
    m.totalAssigned += 1;
    m.moduleSplit.totalAssigned[mod] += 1;
    // Fresh = active Leads pipeline only (not Master Data / Revival-Cold / imported).
    if (isActivePipelineRow(l) && isFreshStatus(l.currentStatus)) {
      m.freshAssigned += 1;
      m.moduleSplit.freshAssigned[mod] += 1;
    }
    if (WEBSITE_SOURCE_LABELS.has(l.source)) m.websiteAssigned += 1;
    if (EVENT_SOURCE_LABELS.has(l.source)) m.eventAssigned += 1;
    if (REVIVAL_ORIGINS.includes(l.leadOrigin) || l.isColdCall) m.revivalAssigned += 1;
    // buyerAssigned stays 0 — BuyerRecord exists but records carry a free-text
    // agentName (no User FK), so per-agent attribution would be fuzzy. Left 0 by design.

    // CURRENT-status breakdown of the agent's current book — DISJOINT buckets
    // (sum to totalAssigned). Uses the single-source leadStatusColumn() so the
    // columns never drift from the status vocabulary.
    switch (leadStatusColumn(l.currentStatus)) {
      case "FRESH": m.curFresh += 1; break;
      case "CONTACTED": m.curContacted += 1; break;
      case "QUALIFIED": m.curQualified += 1; break;
      case "MEETING": m.curMeeting += 1; break;
      case "SITE_VISIT": m.curSiteVisit += 1; break;
      case "NEGOTIATION": m.curNegotiation += 1; break;
      case "BOOKED": m.curBooked += 1; m.moduleSplit.curBooked[mod] += 1; break;
      case "LOST": m.curLost += 1; break;
      default: m.curOther += 1; break;
    }
    if (isWorkableStatus(l.currentStatus)) m.assignedActive += 1;
    // SAME-COHORT rejected: this attributed lead is CURRENTLY rejected
    // (rejectedAt stamped). Numerator for the cohort rejection rate — guaranteed
    // ⊆ totalAssigned, so the rate can never exceed 100%.
    if (l.rejectedAt != null) m.curRejected += 1;
  }

  // ── 2. OUTCOMES (by CURRENT owner — "what is the state of this agent's book") ──
  // These are owner-scoped (ownerId) and status-bucketed. Rejected uses
  // rejectedAt-in-window (rejection is a dated event); the others are the
  // current standing of leads the agent owns (point-in-time book health).
  // Deleted excluded throughout.
  // MODULE-AWARE variants: the rejected / closed / lost / active groupBys add
  // leadOrigin + isColdCall to the `by` so each combo row can be classified into
  // its module (leadSourceModule). The flat total is the sum over all a lead's
  // combos → total === Leads + Master Data + Revival by construction. awaiting /
  // noFollowup are NOT split (they are Leads-pipeline-only via ACTIVE_ORIGIN_WHERE).
  const [
    rejectedRows, closedRows, lostRows, activeRows, awaitingRows, noFuRows,
    rejectedPrevRows, lostPrevRows,
  ] = await Promise.all([
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: { ownerId: { in: agentIds }, deletedAt: null, rejectedAt: win },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: LOST_STATUSES } },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerId", "leadOrigin", "isColdCall"],
      // stillActive — the agent's CANONICAL active book: ACTIVE_LEAD origin (no
      // cold/revival/master-data), non-deleted, non-terminal status. This equals
      // activeLeadWhere({ ownerId }) so the same agent's "active leads" is identical
      // here and on /reports/leaderboard, /reports, /team, /profile, /team/[id].
      // (Under ACTIVE_ORIGIN_WHERE the split will be ~all "Leads", which is correct.)
      where: {
        ownerId: { in: agentIds }, deletedAt: null, ...ACTIVE_ORIGIN_WHERE,
        OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        ownerId: { in: agentIds }, deletedAt: null, ...ACTIVE_ORIGIN_WHERE,
        followupDate: { lt: range.lt, not: null }, // due today or overdue (≤ end of window)
        OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        ownerId: { in: agentIds }, deletedAt: null, ...ACTIVE_ORIGIN_WHERE,
        followupDate: null,
        OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
      },
      _count: { _all: true },
    }),
    // Rejected/Lost leads are UNASSIGNED on reject (ownerId→null) yet keep the
    // owner-at-rejection as previousOwnerId. Attribute those unassigned rows to the
    // previous owner so per-agent Rejected/Lost stays accurate after the hard-unassign
    // (Lalit 2026-06-27). The owner-scoped rows above still catch any not-yet-migrated.
    prisma.lead.groupBy({
      by: ["previousOwnerId", "leadOrigin", "isColdCall"],
      where: { ownerId: null, previousOwnerId: { in: agentIds }, deletedAt: null, rejectedAt: win },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["previousOwnerId", "leadOrigin", "isColdCall"],
      where: { ownerId: null, previousOwnerId: { in: agentIds }, deletedAt: null, currentStatus: { in: LOST_STATUSES } },
      _count: { _all: true },
    }),
  ]);
  // Flat totals + module split from the same combo rows. `metric` names both the
  // flat AgentMetrics field and the ModuleSplit field (they share the name for
  // every bifurcated outcome). The owner variant keys on ownerId; the prev
  // variant keys on previousOwnerId and ADDs onto the same fields.
  applyGroupModule(byId, rejectedRows, "rejected", "ownerId");
  applyGroupModule(byId, closedRows, "closedWon", "ownerId");
  applyGroupModule(byId, lostRows, "lost", "ownerId");
  applyGroupModule(byId, activeRows, "stillActive", "ownerId");
  applyGroup(byId, awaitingRows, (m, n) => (m.awaitingFollowup = n));
  applyGroup(byId, noFuRows, (m, n) => (m.noFollowup = n));
  // Previous-owner (unassigned rejected/lost) combos → same fields, ADD onto them.
  applyGroupModule(byId, rejectedPrevRows, "rejected", "previousOwnerId");
  applyGroupModule(byId, lostPrevRows, "lost", "previousOwnerId");

  // ── 3. ENGAGEMENT (Activity + CallLog + Note, by userId, in window) ──
  // Calls: CallLog is the authoritative call record (the leaderboard uses it).
  // Connected / not-picked split via the shared callOutcome classification.
  // WhatsApp: Activity type=WHATSAPP (the live convention; WhatsAppMessage is
  // barely populated). Notes + voice notes from Note (voiceOriginal != null).
  // Calls / notes / WhatsApp are additionally split by the LEAD's module. Prisma
  // groupBy can't group across the lead relation, so these three pull the joined
  // lead's origin fields via findMany and tally BOTH the flat total and the
  // per-module split in-memory (one row counted once → total === sum of modules).
  // Connected / not-picked / voice stay as groupBy counts (not split).
  const [callActRows, connRows, notPickRows, waActRows, noteActRows, voiceRows] = await Promise.all([
    prisma.callLog.findMany({
      where: { userId: { in: agentIds }, startedAt: win, lead: { deletedAt: null } },
      select: { userId: true, lead: { select: { leadOrigin: true, isColdCall: true } } },
    }),
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, startedAt: win, lead: { deletedAt: null }, outcome: { in: CONNECTED_CALL_OUTCOMES } },
      _count: { _all: true },
    }),
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, startedAt: win, lead: { deletedAt: null }, outcome: { in: NOT_PICKED_CALL_OUTCOMES } },
      _count: { _all: true },
    }),
    prisma.activity.findMany({
      where: { userId: { in: agentIds }, type: "WHATSAPP", createdAt: win, lead: { deletedAt: null } },
      select: { userId: true, lead: { select: { leadOrigin: true, isColdCall: true } } },
    }),
    prisma.note.findMany({
      where: { userId: { in: agentIds }, createdAt: win, lead: { deletedAt: null } },
      select: { userId: true, lead: { select: { leadOrigin: true, isColdCall: true } } },
    }),
    prisma.note.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, createdAt: win, voiceOriginal: { not: null }, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  applyActivityModule(byId, callActRows, "callsLogged");
  applyGroupU(byId, connRows, (m, n) => (m.connectedCalls = n));
  applyGroupU(byId, notPickRows, (m, n) => (m.notPickedCalls = n));
  applyActivityModule(byId, waActRows, "whatsappConversations");
  applyActivityModule(byId, noteActRows, "notesAdded");
  applyGroupU(byId, voiceRows, (m, n) => (m.voiceNotesAdded = n));

  // ── 4. MEETINGS + SITE VISITS (Activity, by userId, in window) ──
  // "Scheduled" = activity rows of that type created in window (regardless of
  // outcome). "Completed" = status DONE. Office/Virtual counted by type.
  // Site visits: scheduled / DONE / CANCELLED. EXPO_MEETING + HOME_VISIT roll
  // into the meeting bucket so nothing is silently dropped.
  // meetingsScheduled + siteVisitsScheduled carry the module split (findMany with
  // the joined lead origin, tallied in-memory). meetingsCompleted / office /
  // virtual / site-visit done / cancelled stay as plain groupBy counts.
  const [meetSchedRows, meetDone, officeRows, virtualRows, svSchedRows, svDone, svCancel] = await Promise.all([
    prisma.activity.findMany({
      where: { userId: { in: agentIds }, type: { in: MEETING_ACTIVITY_TYPES }, createdAt: win, lead: { deletedAt: null } },
      select: { userId: true, lead: { select: { leadOrigin: true, isColdCall: true } } },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: { in: MEETING_ACTIVITY_TYPES }, status: "DONE", createdAt: win, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: "OFFICE_MEETING", createdAt: win, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: "VIRTUAL_MEETING", createdAt: win, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.activity.findMany({
      where: { userId: { in: agentIds }, type: "SITE_VISIT", createdAt: win, lead: { deletedAt: null } },
      select: { userId: true, lead: { select: { leadOrigin: true, isColdCall: true } } },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: "SITE_VISIT", status: "DONE", createdAt: win, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: "SITE_VISIT", status: "CANCELLED", createdAt: win, lead: { deletedAt: null } },
      _count: { _all: true },
    }),
  ]);
  applyActivityModule(byId, meetSchedRows, "meetingsScheduled");
  applyGroupU(byId, meetDone, (m, n) => (m.meetingsCompleted = n));
  applyGroupU(byId, officeRows, (m, n) => (m.officeMeetings = n));
  applyGroupU(byId, virtualRows, (m, n) => (m.virtualMeetings = n));
  applyActivityModule(byId, svSchedRows, "siteVisitsScheduled");
  applyGroupU(byId, svDone, (m, n) => (m.siteVisitsCompleted = n));
  applyGroupU(byId, svCancel, (m, n) => (m.siteVisitsCancelled = n));

  // ── 5. CONVERSION FUNNEL (per agent, current owner + current status) ──
  // Status-only funnel: Assigned → Qualified(reached any meeting/visit/nego/
  // booking stage) → Meetings → Site Visits → Negotiations → Bookings. Counts
  // are of CURRENTLY-owned, non-deleted leads at each status stage.
  const FUNNEL_QUALIFIED = [...new Set([...MEETING_STATUSES, ...SITE_VISIT_STATUSES, ...NEGOTIATION_STATUSES, ...BOOKING_STATUSES])];
  const [fAssigned, fQual, fMeet, fSite, fNego, fBook] = await Promise.all([
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: FUNNEL_QUALIFIED } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: MEETING_STATUSES } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: SITE_VISIT_STATUSES } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: NEGOTIATION_STATUSES } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: agentIds }, deletedAt: null, currentStatus: { in: BOOKING_STATUSES } }, _count: { _all: true } }),
  ]);
  applyGroup(byId, fAssigned, (m, n) => (m.funnelAssigned = n));
  applyGroup(byId, fQual, (m, n) => (m.funnelQualified = n));
  applyGroup(byId, fMeet, (m, n) => (m.funnelMeetings = n));
  applyGroup(byId, fSite, (m, n) => (m.funnelSiteVisits = n));
  applyGroup(byId, fNego, (m, n) => (m.funnelNegotiations = n));
  applyGroup(byId, fBook, (m, n) => (m.funnelBookings = n));

  // Internal invariant: every bifurcated total === the sum of its 3 module parts.
  // Dev-time guard only (logs on drift; never throws in prod so a report never
  // 500s over an accounting mismatch). See MODULE_SPLIT_METRICS.
  for (const m of byId.values()) assertSplitsSumToTotals(m);

  // Stable order: by agent name (matches scopedAgents()).
  return agents.map((a) => byId.get(a.id)!);
}

// ── Module-split appliers ─────────────────────────────────────────────────────
// applyGroupModule: for a groupBy keyed on [ownerId|previousOwnerId, leadOrigin,
// isColdCall], accumulate BOTH the flat metric total AND the per-module split.
// `metric` names the shared field on AgentMetrics + ModuleSplit. `ownerKey`
// selects which id column attributes the row. Both flat + split use += so the
// previous-owner pass adds cleanly onto the owner pass.
function applyGroupModule(
  byId: Map<string, AgentMetrics>,
  rows: Array<{
    ownerId?: string | null;
    previousOwnerId?: string | null;
    leadOrigin: string | null;
    isColdCall: boolean | null;
    _count: { _all: number };
  }>,
  metric: keyof ModuleSplit & keyof AgentMetrics,
  ownerKey: "ownerId" | "previousOwnerId",
): void {
  for (const r of rows) {
    const id = ownerKey === "ownerId" ? r.ownerId : r.previousOwnerId;
    if (!id) continue;
    const m = byId.get(id);
    if (!m) continue;
    const n = r._count._all;
    (m[metric] as number) += n;
    m.moduleSplit[metric][leadSourceModule(r.leadOrigin, r.isColdCall)] += n;
  }
}

// applyActivityModule: for Activity/CallLog/Note rows pulled via findMany with the
// joined lead's origin, accumulate the flat metric AND its module split by
// counting one per row (module from the row's lead). Rows whose lead is missing
// (should not happen — the where filters deletedAt) are skipped defensively.
function applyActivityModule(
  byId: Map<string, AgentMetrics>,
  rows: Array<{ userId: string | null; lead: { leadOrigin: string | null; isColdCall: boolean | null } | null }>,
  metric: keyof ModuleSplit & keyof AgentMetrics,
): void {
  for (const r of rows) {
    if (!r.userId || !r.lead) continue;
    const m = byId.get(r.userId);
    if (!m) continue;
    (m[metric] as number) += 1;
    m.moduleSplit[metric][leadSourceModule(r.lead.leadOrigin, r.lead.isColdCall)] += 1;
  }
}

/** Sum the 3 lead-module parts of a split field. */
export function moduleTripleTotal(t: ModuleTriple): number {
  return LEAD_SOURCE_MODULES.reduce((s, mod) => s + (t[mod] ?? 0), 0);
}

/**
 * Dev-time invariant check: for every bifurcated metric, the flat total must
 * equal Leads + Master Data + Revival. Logs a warning on drift (never throws —
 * a reporting page must not 500 over an internal accounting mismatch).
 */
function assertSplitsSumToTotals(m: AgentMetrics): void {
  if (process.env.NODE_ENV === "production") return;
  for (const key of MODULE_SPLIT_METRICS) {
    const total = m[key] as number;
    const parts = moduleTripleTotal(m.moduleSplit[key]);
    if (total !== parts) {
      // eslint-disable-next-line no-console
      console.warn(
        `[agentPerformance] module split mismatch for ${m.agentName} · ${key}: total=${total} parts=${parts}`,
      );
    }
  }
}

// groupBy result appliers — ownerId variant and userId variant.
function applyGroup(
  byId: Map<string, AgentMetrics>,
  rows: Array<{ ownerId: string | null; _count: { _all: number } }>,
  set: (m: AgentMetrics, n: number) => void,
): void {
  for (const r of rows) {
    if (!r.ownerId) continue;
    const m = byId.get(r.ownerId);
    if (m) set(m, r._count._all);
  }
}
// (applyGroupP removed 2026-07-06 — the previous-owner rejected/lost attribution
//  now flows through applyGroupModule with ownerKey:"previousOwnerId", which also
//  accumulates the module split.)
function applyGroupU(
  byId: Map<string, AgentMetrics>,
  rows: Array<{ userId: string | null; _count: { _all: number } }>,
  set: (m: AgentMetrics, n: number) => void,
): void {
  for (const r of rows) {
    if (!r.userId) continue;
    const m = byId.get(r.userId);
    if (m) set(m, r._count._all);
  }
}

// ── Summary roll-up (dashboard widget cards) ─────────────────────────────────
// Aggregate the per-agent rows into the headline numbers + rates for the
// selected window/team.
//
// COHORT RULE (the single invariant this widget guarantees): EVERY percentage's
// numerator AND denominator come from the SAME assigned-in-window cohort. The
// denominator is always totalAssigned (the cohort); each numerator is the count
// of cohort members CURRENTLY in that state (curBooked / curRejected / curMeeting
// / curSiteVisit / assignedActive). Because each numerator is a subset of the
// cohort, every rate is mathematically in [0,100]% and means exactly what it says.
//
// This is why `totalRejectedCohort` uses `curRejected` (cohort members currently
// rejected) and NOT `m.rejected` (the owner-scoped count of ALL rejections dated
// in the window). The old code divided owner-scoped rejections by the cohort and
// could exceed 100% (the reported "233.3%": 7 rejected-in-window ÷ 3 assigned).
//   • totalRejectedCohort  — cohort number, drives Rejection Rate (≤100%).
//   • totalRejectedInWindow — the standalone owner-scoped COUNT, shown as a count
//     only (no % over the cohort), preserved for the per-agent grid's "Rejected"
//     column which is explicitly labelled "rejected in this window".
export interface ReportSummary {
  totalAssigned: number;
  totalActive: number;
  /** Cohort members CURRENTLY rejected — the Rejection-Rate numerator. */
  totalRejectedCohort: number;
  /** Owner-scoped rejections dated in the window — a COUNT only (not a cohort %). */
  totalRejectedInWindow: number;
  totalBooked: number;
  totalLost: number;
  totalMeetings: number;   // assigned-in-window cohort currently at meeting stage
  totalSiteVisits: number; // assigned-in-window cohort currently at site-visit stage
  conversionRatePct: number; // curBooked ÷ assigned cohort
  rejectionRatePct: number;  // curRejected ÷ assigned cohort  (same cohort → ≤100%)
  meetingRatePct: number;    // curMeeting ÷ assigned cohort
  siteVisitRatePct: number;  // curSiteVisit ÷ assigned cohort
}

export function summarizeReport(rows: AgentMetrics[]): ReportSummary {
  const s = rows.reduce(
    (acc, m) => {
      acc.totalAssigned += m.totalAssigned;
      acc.totalActive += m.assignedActive;
      acc.totalRejectedCohort += m.curRejected;
      acc.totalRejectedInWindow += m.rejected;
      acc.totalBooked += m.curBooked;
      acc.totalLost += m.curLost;
      acc.totalMeetings += m.curMeeting;
      acc.totalSiteVisits += m.curSiteVisit;
      return acc;
    },
    { totalAssigned: 0, totalActive: 0, totalRejectedCohort: 0, totalRejectedInWindow: 0, totalBooked: 0, totalLost: 0, totalMeetings: 0, totalSiteVisits: 0 },
  );
  // Same-cohort ratio, clamped to [0,100] as a belt-and-braces guard. With a
  // subset numerator the clamp is a no-op, but it makes the invariant explicit
  // and unbreakable even if a future numerator is mis-wired.
  const pct = (n: number) => {
    if (s.totalAssigned <= 0) return 0;
    return Math.min(100, Math.max(0, (n / s.totalAssigned) * 100));
  };
  return {
    ...s,
    conversionRatePct: pct(s.totalBooked),
    rejectionRatePct: pct(s.totalRejectedCohort),
    meetingRatePct: pct(s.totalMeetings),
    siteVisitRatePct: pct(s.totalSiteVisits),
  };
}

// ── Derived ratios (for detail view / rankings) ──────────────────────────────

/** Connect rate = connected ÷ total calls (0 when no calls). */
export function connectRate(m: AgentMetrics): number {
  return m.callsLogged > 0 ? (m.connectedCalls / m.callsLogged) * 100 : 0;
}
/** Conversion = bookings ÷ assigned (current book), 0 when no leads. */
export function conversionRate(m: AgentMetrics): number {
  return m.funnelAssigned > 0 ? (m.funnelBookings / m.funnelAssigned) * 100 : 0;
}
/**
 * Follow-up compliance = how much of the owned, due/overdue follow-up load is
 * NOT overdue. Here: (1 - overdueDue / totalActive) when there are active leads.
 * A lower compliance = more leads sitting past their follow-up date.
 */
export function followupCompliance(m: AgentMetrics): number {
  const denom = m.stillActive;
  if (denom <= 0) return 100;
  const overdue = Math.min(m.awaitingFollowup, denom);
  return Math.max(0, (1 - overdue / denom) * 100);
}

// ── Drill-down (reconciliation) ──────────────────────────────────────────────
// Every table metric maps to a key here. The detail page links to a filtered
// lead list whose query == the metric's query, so "N records" on screen
// reconciles 1:1 with the count. For assignment-history metrics, the where is
// a lead-level fragment ANDed with "has an assignment to this agent in window"
// (Lead.assignments.some) — the same population the count came from.

export type DrillKey =
  | "totalAssigned" | "freshAssigned" | "websiteAssigned" | "eventAssigned" | "revivalAssigned"
  | "rejected" | "closedWon" | "lost" | "stillActive" | "awaitingFollowup" | "noFollowup"
  | "funnelQualified" | "funnelMeetings" | "funnelSiteVisits" | "funnelNegotiations" | "funnelBookings"
  // CURRENT-status breakdown of the assigned-in-window population (dashboard grid).
  | "curFresh" | "curContacted" | "curQualified" | "curMeeting" | "curSiteVisit"
  | "curNegotiation" | "curBooked" | "curLost" | "curOther" | "assignedActive"
  | "curRejected";

const ACTIVE_OR: Prisma.LeadWhereInput["OR"] = [
  { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
];

/**
 * Build the exact Prisma where-clause behind a metric, for a given agent +
 * window. Used by the drill-down page so the list it shows matches the count.
 */
export function drilldownWhere(key: DrillKey, agentId: string, range: DateRange): Prisma.LeadWhereInput {
  const win = { gte: range.gte, lt: range.lt };
  // CURRENT-attribution population: the agent owns the lead NOW, OR it is a lead
  // they owned that is now rejected-and-unassigned (reject nulls ownerId but
  // keeps previousOwnerId — same shape as the `rejected`/`lost` drills). This
  // matches the count side and reconciles with search / leads-list / export.
  // Wrapped in AND:[{OR}] so case branches can add their own top-level OR
  // (status sets) without clobbering the owner clause.
  const currentlyOwned: Prisma.LeadWhereInput = {
    deletedAt: null,
    AND: [{ OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }] }],
  };
  switch (key) {
    case "totalAssigned":
      return currentlyOwned;
    case "freshAssigned":
      // Use the CANONICAL fresh set (8 casings) so the drill matches the card's
      // isFreshStatus()-based count (the local 6-value list under-counted by 2).
      return { ...currentlyOwned, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { in: FRESH_STATUS_IN_VALUES } }] };
    case "websiteAssigned":
      return { ...currentlyOwned, source: { in: WEBSITE_SOURCE_ENUMS } };
    case "eventAssigned":
      return { ...currentlyOwned, source: { in: EVENT_SOURCE_ENUMS } };
    case "revivalAssigned":
      return { ...currentlyOwned, OR: [{ leadOrigin: { in: REVIVAL_ORIGINS } }, { isColdCall: true }] };
    case "rejected":
      // Rejected leads are UNASSIGNED (ownerId→null) but keep previousOwnerId — match
      // owned (legacy) OR unassigned-with-previousOwner so the drill == the summary.
      return { deletedAt: null, rejectedAt: win, OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }] };
    case "closedWon":
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } };
    case "lost":
      return { deletedAt: null, currentStatus: { in: LOST_STATUSES }, OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }] };
    case "stillActive":
      // Canonical active book (ACTIVE_LEAD origin) — count==drill with stillActive.
      return { ownerId: agentId, deletedAt: null, ...ACTIVE_ORIGIN_WHERE, OR: ACTIVE_OR };
    case "awaitingFollowup":
      return { ownerId: agentId, deletedAt: null, ...ACTIVE_ORIGIN_WHERE, followupDate: { lt: range.lt, not: null }, OR: ACTIVE_OR };
    case "noFollowup":
      return { ownerId: agentId, deletedAt: null, ...ACTIVE_ORIGIN_WHERE, followupDate: null, OR: ACTIVE_OR };
    case "funnelQualified": {
      const FUNNEL_QUALIFIED = [...new Set([...MEETING_STATUSES, ...SITE_VISIT_STATUSES, ...NEGOTIATION_STATUSES, ...BOOKING_STATUSES])];
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: FUNNEL_QUALIFIED } };
    }
    case "funnelMeetings":
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: MEETING_STATUSES } };
    case "funnelSiteVisits":
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: SITE_VISIT_STATUSES } };
    case "funnelNegotiations":
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: NEGOTIATION_STATUSES } };
    case "funnelBookings":
      return { ownerId: agentId, deletedAt: null, currentStatus: { in: BOOKING_STATUSES } };

    // ── CURRENT-status columns: the current-owner population, bucketed by
    // current status. AND currentlyOwned with the same status predicate
    // leadStatusColumn() uses, so count == drill records exactly. ──
    case "curFresh":
      return { ...currentlyOwned, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { in: FRESH_STATUS_IN_VALUES } }] };
    case "curContacted":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.CONTACTED ?? [] } };
    case "curQualified":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.QUALIFIED ?? [] } };
    case "curMeeting":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.MEETING ?? [] } };
    case "curSiteVisit":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.SITE_VISIT ?? [] } };
    case "curNegotiation":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.NEGOTIATION ?? [] } };
    case "curBooked":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.BOOKED ?? [] } };
    case "curLost":
      return { ...currentlyOwned, currentStatus: { in: COLUMN_STATUS_VALUES.LOST ?? [] } };
    case "curOther":
      // Closed-non-win + any unmapped status: NOT fresh, NOT listed in any column.
      return {
        ...currentlyOwned,
        currentStatus: { notIn: [...COLUMN_NON_OPEN_STATUSES, ...FRESH_STATUS_IN_VALUES], not: null },
        NOT: { currentStatus: "" },
      };
    case "assignedActive":
      // Assigned-in-window AND currently workable (not terminal).
      return { ...currentlyOwned, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] };
    case "curRejected":
      // SAME-COHORT rejected: assigned-in-window AND currently rejected
      // (rejectedAt stamped). This is the drill behind the Rejection-Rate
      // numerator — its record count == curRejected exactly. (Distinct from the
      // `rejected` drill, which is owner-scoped rejectedAt-in-window.)
      return { ...currentlyOwned, rejectedAt: { not: null } };

    default:
      return { deletedAt: null, id: "__none__" }; // never matches
  }
}

// (FRESH_STATUS_VALUES removed 2026-06-27 — freshAssigned now uses the canonical
//  FRESH_STATUS_IN_VALUES from lead-statuses, matching isFreshStatus + curFresh.)

/** Human label for a drill-down key — used on the filtered-list page header. */
export const DRILL_LABELS: Record<DrillKey, string> = {
  totalAssigned: "Total Leads Assigned",
  freshAssigned: "Fresh Leads Assigned",
  websiteAssigned: "Website Leads Assigned",
  eventAssigned: "Event Leads Assigned",
  revivalAssigned: "Revival Leads Assigned",
  rejected: "Leads Rejected",
  closedWon: "Leads Closed (booked / sold / elsewhere)",
  lost: "Leads Lost",
  stillActive: "Leads Still Active",
  awaitingFollowup: "Leads Awaiting Follow-up",
  noFollowup: "Leads With No Follow-up",
  funnelQualified: "Qualified Leads",
  funnelMeetings: "Leads at Meeting Stage",
  funnelSiteVisits: "Leads at Site-Visit Stage",
  funnelNegotiations: "Leads in Negotiation",
  funnelBookings: "Bookings / Closures",
  // Current-status breakdown of the assigned-in-window population.
  curFresh: "Assigned · Currently Fresh",
  curContacted: "Assigned · Currently Contacted",
  curQualified: "Assigned · Currently Qualified",
  curMeeting: "Assigned · Currently at Meeting",
  curSiteVisit: "Assigned · Currently at Site Visit",
  curNegotiation: "Assigned · Currently in Negotiation",
  curBooked: "Assigned · Booked / Won",
  curLost: "Assigned · Lost",
  curOther: "Assigned · Other Outcome",
  assignedActive: "Assigned · Currently Active",
  curRejected: "Assigned · Currently Rejected",
};

/** Source-of-truth for the metric used by the CSV export (label + accessor). */
export interface MetricColumn {
  key: string;
  label: string;
  group: string;
  get: (m: AgentMetrics) => number | string;
}

export const METRIC_COLUMNS: MetricColumn[] = [
  { key: "agent", label: "Agent", group: "", get: (m) => m.agentName },
  { key: "team", label: "Team", group: "", get: (m) => m.team ?? "" },
  // Assignment
  { key: "totalAssigned", label: "Total Assigned", group: "Assignment", get: (m) => m.totalAssigned },
  { key: "freshAssigned", label: "Fresh Assigned", group: "Assignment", get: (m) => m.freshAssigned },
  { key: "websiteAssigned", label: "Website Assigned", group: "Assignment", get: (m) => m.websiteAssigned },
  { key: "eventAssigned", label: "Event Assigned", group: "Assignment", get: (m) => m.eventAssigned },
  { key: "revivalAssigned", label: "Revival Assigned", group: "Assignment", get: (m) => m.revivalAssigned },
  { key: "buyerAssigned", label: "Buyer Assigned", group: "Assignment", get: (m) => m.buyerAssigned },
  // Live status breakdown of the assigned-in-window population (dashboard grid)
  { key: "curFresh", label: "Current Fresh", group: "Live Status", get: (m) => m.curFresh },
  { key: "curContacted", label: "Contacted", group: "Live Status", get: (m) => m.curContacted },
  { key: "curQualified", label: "Qualified", group: "Live Status", get: (m) => m.curQualified },
  { key: "curMeeting", label: "Meeting", group: "Live Status", get: (m) => m.curMeeting },
  { key: "curSiteVisit", label: "Site Visit", group: "Live Status", get: (m) => m.curSiteVisit },
  { key: "curNegotiation", label: "Negotiation", group: "Live Status", get: (m) => m.curNegotiation },
  { key: "curBooked", label: "Booked/Won", group: "Live Status", get: (m) => m.curBooked },
  { key: "curLost", label: "Lost (assigned)", group: "Live Status", get: (m) => m.curLost },
  { key: "curRejected", label: "Rejected (assigned cohort)", group: "Live Status", get: (m) => m.curRejected },
  { key: "curOther", label: "Other (assigned)", group: "Live Status", get: (m) => m.curOther },
  { key: "assignedActive", label: "Active (assigned)", group: "Live Status", get: (m) => m.assignedActive },
  // Outcomes
  { key: "rejected", label: "Rejected", group: "Outcomes", get: (m) => m.rejected },
  { key: "closedWon", label: "Closed (final)", group: "Outcomes", get: (m) => m.closedWon },
  { key: "lost", label: "Lost", group: "Outcomes", get: (m) => m.lost },
  { key: "stillActive", label: "Still Active", group: "Outcomes", get: (m) => m.stillActive },
  { key: "awaitingFollowup", label: "Awaiting Follow-up", group: "Outcomes", get: (m) => m.awaitingFollowup },
  { key: "noFollowup", label: "No Follow-up", group: "Outcomes", get: (m) => m.noFollowup },
  // Engagement
  { key: "callsLogged", label: "Calls Logged", group: "Engagement", get: (m) => m.callsLogged },
  { key: "connectedCalls", label: "Connected Calls", group: "Engagement", get: (m) => m.connectedCalls },
  { key: "notPickedCalls", label: "Not Picked Calls", group: "Engagement", get: (m) => m.notPickedCalls },
  { key: "whatsappConversations", label: "WhatsApp Conversations", group: "Engagement", get: (m) => m.whatsappConversations },
  { key: "notesAdded", label: "Notes Added", group: "Engagement", get: (m) => m.notesAdded },
  { key: "voiceNotesAdded", label: "Voice Notes Added", group: "Engagement", get: (m) => m.voiceNotesAdded },
  // Meetings
  { key: "meetingsScheduled", label: "Meetings Scheduled", group: "Meetings", get: (m) => m.meetingsScheduled },
  { key: "meetingsCompleted", label: "Meetings Completed", group: "Meetings", get: (m) => m.meetingsCompleted },
  { key: "officeMeetings", label: "Office Meetings", group: "Meetings", get: (m) => m.officeMeetings },
  { key: "virtualMeetings", label: "Virtual Meetings", group: "Meetings", get: (m) => m.virtualMeetings },
  // Site visits
  { key: "siteVisitsScheduled", label: "Site Visits Scheduled", group: "Site Visits", get: (m) => m.siteVisitsScheduled },
  { key: "siteVisitsCompleted", label: "Site Visits Completed", group: "Site Visits", get: (m) => m.siteVisitsCompleted },
  { key: "siteVisitsCancelled", label: "Site Visits Cancelled", group: "Site Visits", get: (m) => m.siteVisitsCancelled },
  // Funnel
  { key: "funnelQualified", label: "Funnel: Qualified", group: "Funnel", get: (m) => m.funnelQualified },
  { key: "funnelMeetings", label: "Funnel: Meetings", group: "Funnel", get: (m) => m.funnelMeetings },
  { key: "funnelSiteVisits", label: "Funnel: Site Visits", group: "Funnel", get: (m) => m.funnelSiteVisits },
  { key: "funnelNegotiations", label: "Funnel: Negotiations", group: "Funnel", get: (m) => m.funnelNegotiations },
  { key: "funnelBookings", label: "Funnel: Bookings", group: "Funnel", get: (m) => m.funnelBookings },
  // Derived
  { key: "connectRate", label: "Connect %", group: "Derived", get: (m) => connectRate(m).toFixed(1) },
  { key: "conversionRate", label: "Conversion %", group: "Derived", get: (m) => conversionRate(m).toFixed(1) },
  { key: "followupCompliance", label: "Follow-up Compliance %", group: "Derived", get: (m) => followupCompliance(m).toFixed(1) },
  // ── Module bifurcation (additive) — each bifurcated metric × 3 lead modules.
  // Same numbers as the on-screen expandable breakdown; total column already
  // above (e.g. "Total Assigned") == the sum of its 3 module columns here.
  ...MODULE_SPLIT_METRICS.flatMap((key) =>
    LEAD_SOURCE_MODULES.map((mod): MetricColumn => ({
      key: `${key}__${mod}`,
      label: `${key} · ${mod}`,
      group: "Module Split",
      get: (m) => m.moduleSplit[key][mod],
    })),
  ),
];

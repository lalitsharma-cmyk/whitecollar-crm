// ────────────────────────────────────────────────────────────────────────────
// BUYER DATA PERFORMANCE ENGINE  (Part 6 — Buyer Data reporting)
//
// The parallel of src/lib/agentPerformance.ts, for the Buyer Data worked
// pipeline. Single source of truth for /reports/buyer-performance. Computes a
// typed per-agent metric object that is:
//   • DATE-WINDOW aware    — every metric respects an IST day-boundary range
//     (the EXACT same window math as agentPerformance.ts; re-exported below).
//   • STINT-HISTORY based for "Buyer Records Assigned" — counts by the
//     BuyerAssignment table (the agent who HELD the buyer when a stint opened in
//     the window), de-duped per (buyer, agent). Mirrors the lead report's
//     assignment-history attribution: a buyer reassigned later still counts for
//     whoever worked it.
//   • EVENT-LOG based for outcomes & engagement — Converted / Rejected / Calls /
//     WhatsApp / Notes / Voice / Attempts come from BuyerActivity rows authored
//     by the agent (userId) in the window — every one is a dated, drillable event.
//   • DELETED EXCLUDED everywhere (buyer.deletedAt: null). A soft-deleted
//     (recycle-bin) buyer never counts toward any metric or summary total.
//   • RECONCILABLE — every count has a matching drill-down query in
//     buyerDrilldownWhere() so "N records" on screen == N BuyerRecords in the list.
//
// Rejected / returned buyers STILL COUNT toward the agent's handled volume — the
// stint-history attribution is independent of the buyer's terminal state.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import type { Prisma } from "@prisma/client";
import { CallOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BUYER_ACTIVITY_TYPE,
  BUYER_RETURN_REASON,
  ATTEMPT_TYPES,
} from "@/lib/buyerLifecycle";

// ── Date windows (IST day boundaries) ────────────────────────────────────────
// Re-use the agent-performance window contract verbatim so the two reports share
// the SAME presets / IST boundaries / custom-range parsing. We re-implement the
// tiny IST helpers here (agentPerformance keeps them private) but the semantics
// are byte-identical, and resolveDateRange + RANGE_OPTIONS are re-exported from
// agentPerformance so a single selector component drives both reports.

export {
  resolveDateRange,
  RANGE_OPTIONS,
  type RangePreset,
  type DateRange,
} from "@/lib/agentPerformance";
import type { DateRange } from "@/lib/agentPerformance";

// ── Scope ────────────────────────────────────────────────────────────────────
// Same contract as the agent report. ADMIN sees all agents (+ optional team
// filter); MANAGER is locked to their own team; AGENT is restricted to their own
// row (own-row-only — mirrors agent-performance gating). The Admin Pool itself is
// owner-less, so it is reported only in the admin SUMMARY, never as an agent row.

export interface BuyerReportScope {
  role: "ADMIN" | "MANAGER" | "AGENT";
  /** Self id — used to restrict an AGENT to their own row. */
  meId: string;
  /** "India" | "Dubai" | null — when set, restricts agents + team scope. */
  team?: string | null;
}

export interface BuyerAgentLite {
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
 * Identical population to agentPerformance.scopedAgents — buyers are worked by
 * the same sales users, so the agent universe matches.
 */
export async function scopedBuyerAgents(scope: BuyerReportScope): Promise<BuyerAgentLite[]> {
  if (scope.role === "AGENT") {
    const u = await prisma.user.findUnique({
      where: { id: scope.meId },
      select: { id: true, name: true, team: true, role: true },
    });
    return u ? [u] : [];
  }
  // Buyer Data Performance — MARKET-AWARE. The agent universe is the market's own
  // team AGENT/MANAGER PLUS admins (admins can hold any market's buyers). The other
  // market's team + HR are excluded. scope.team drives it: "India" → India team,
  // anything else (incl. null, the legacy Dubai default) → Dubai team.
  const rosterTeam = scope.team === "India" ? "India" : "Dubai";
  const where: Prisma.UserWhereInput = {
    active: true,
    hrOnly: false,
    OR: [
      { team: rosterTeam, role: { in: ["AGENT", "MANAGER"] } },
      { role: "ADMIN" },
    ],
  };
  return prisma.user.findMany({
    where,
    select: { id: true, name: true, team: true, role: true },
    orderBy: { name: "asc" },
  });
}

// ── Metric shape ─────────────────────────────────────────────────────────────
// One flat typed object per agent. Adding a future metric = add a field here +
// populate it in buildBuyerReport(). Drill-down keys map 1:1 to buyerDrilldownWhere().

export interface BuyerAgentMetrics {
  agentId: string;
  agentName: string;
  team: string | null;

  // ── Assignment (by STINT HISTORY in window — de-duped per buyer per agent) ──
  buyersAssigned: number;

  // ── Outcomes (BuyerActivity by agent in window) ──
  converted: number; // CONVERTED activity authored by agent
  rejected: number; // REJECTED activity authored by agent (manual reject/return)

  // ── Returns to Admin Pool (closed stints in window, by reason) ──
  autoReturned: number; // BuyerAssignment.returnReason = AUTO_5_ATTEMPTS, returnedAt in window
  manualReturned: number; // BuyerAssignment.returnReason = MANUAL_REJECT, returnedAt in window

  // ── Contact activity (BuyerActivity by type, by agent, in window) ──
  callsLogged: number;
  whatsappInteractions: number;
  notesAdded: number;
  voiceNotesAdded: number;

  // ── Attempt metrics ──
  totalAttempts: number; // ATTEMPT_* activities authored by agent in window
  // averageAttemptsPerBuyer is derived (totalAttempts / buyersWorked) — see avgAttempts()

  // ── Conversion funnel (per agent, within the window's worked book) ──
  // Assigned → Contacted (>=1 contact activity) → Engaged (>=1 call/WhatsApp) → Converted.
  funnelAssigned: number; // == buyersAssigned (stints opened in window)
  funnelContacted: number; // of those, how many got >=1 contact activity (any kind) in window
  funnelEngaged: number; // of those, how many got >=1 CALL or WHATSAPP in window
  funnelConverted: number; // of those, how many the agent CONVERTED in window
}

/** Empty metrics for an agent — the additive baseline. */
function zeroBuyerMetrics(a: BuyerAgentLite): BuyerAgentMetrics {
  return {
    agentId: a.id,
    agentName: a.name,
    team: a.team,
    buyersAssigned: 0,
    converted: 0,
    rejected: 0,
    autoReturned: 0,
    manualReturned: 0,
    callsLogged: 0,
    whatsappInteractions: 0,
    notesAdded: 0,
    voiceNotesAdded: 0,
    totalAttempts: 0,
    funnelAssigned: 0,
    funnelContacted: 0,
    funnelEngaged: 0,
    funnelConverted: 0,
  };
}

// Activity-type groupings (shared with the drill-down so counts reconcile).
const ATTEMPT_TYPE_LIST: string[] = [...ATTEMPT_TYPES];
// "Contact activity" = a real human touch (calls/notes/WA/voice) OR a logged
// attempt. Lifecycle rows (ASSIGNED/RETURNED/CONVERTED/REJECTED) are excluded —
// they are state transitions, not the agent reaching out.
const CONTACT_TYPE_LIST: string[] = [
  BUYER_ACTIVITY_TYPE.CALL,
  BUYER_ACTIVITY_TYPE.NOTE,
  BUYER_ACTIVITY_TYPE.WHATSAPP,
  BUYER_ACTIVITY_TYPE.VOICE_NOTE,
  ...ATTEMPT_TYPE_LIST,
];
// "Engaged" = a two-way-capable channel: a call placed or a WhatsApp message.
const ENGAGED_TYPE_LIST: string[] = [BUYER_ACTIVITY_TYPE.CALL, BUYER_ACTIVITY_TYPE.WHATSAPP];

// ── CALLS: single source = CallLog (2026-07-18) ──────────────────────────────
// The buyer contact flow writes a CallLog row (buyerId set) for every real phone
// call, in the same transaction as the BuyerActivity timeline row — see
// src/lib/buyerLifecycle.ts. `callsLogged` is therefore counted from CallLog and
// NEVER from BuyerActivity: the same call now lives in both tables, so counting
// both would DOUBLE-COUNT it.
//
// What deliberately STAYS on BuyerActivity in this file (none of these are call
// counts, so none can double-count):
//   • totalAttempts — the ATTEMPT_* cycle that drives attemptCount and the
//     auto-return-at-5 rule. It INCLUDES ATTEMPT_WA_NO_RESPONSE, which is a
//     WhatsApp non-response and writes NO CallLog; sourcing it from CallLog would
//     silently drop those attempts and de-sync the metric from attemptCount.
//   • notesAdded / whatsappInteractions / voiceNotesAdded / converted / rejected.
//   • the funnel stages — they count DISTINCT BUYERS that have >=1 activity of a
//     kind, not events, so they are set memberships and cannot be double-counted.
//
// A buyer call CONNECTED = the shared outcome set (parity with the lead report's
// connectedCalls), since buyerLifecycle maps a manual CALL → CONNECTED.
//
// UNRESOLVED DIALS (Lalit P0, 2026-07-18): every CallLog read in this file is an
// ALLOW-LIST on this set, so the dial-on-tap states (INITIATED / RINGING) are
// already excluded — no notIn guard was added here, deliberately, rather than
// bolting on a redundant filter. ⚠️ That safety is a PROPERTY OF THE ALLOW-LIST:
// if a future change counts buyer calls WITHOUT `outcome: { in: … }` (e.g. a
// "total dials" or "attempted" metric), it must add
// `outcome: { notIn: [...PENDING_CALL_OUTCOMES] }` from lib/ghosting — otherwise
// taps start inflating buyer call volume. See lib/agentPerformance.ts, where the
// two unfiltered totals needed exactly that guard.
const CONNECTED_BUYER_CALL_OUTCOMES: CallOutcome[] = [
  CallOutcome.CONNECTED, CallOutcome.INTERESTED, CallOutcome.NOT_INTERESTED,
];

// ── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build the full per-agent buyer metric set for a date range + scope. One
 * aggregated object per scoped agent. All queries exclude deleted buyers and
 * honor the window. Returns rows in the agent's name order (stable for the table).
 */
export async function buildBuyerReport(
  range: DateRange,
  scope: BuyerReportScope,
): Promise<BuyerAgentMetrics[]> {
  const agents = await scopedBuyerAgents(scope);
  if (agents.length === 0) return [];
  const agentIds = agents.map((a) => a.id);
  const byId = new Map(agents.map((a) => [a.id, zeroBuyerMetrics(a)]));

  // Market-scope every buyer query. scope.team "India" → India market; else (incl.
  // null, the legacy Dubai default) → Dubai. Keeps the two markets fully separate.
  const market = scope.team === "India" ? "India" : "Dubai";
  const win = { gte: range.gte, lt: range.lt };

  // ── 1. ASSIGNMENT — stints opened in window (the attribution backbone) ──
  // Every BuyerAssignment stint whose assignedAt is in the window, for these
  // agents, joined to its (non-deleted) buyer. De-dupe per (buyer, agent): the
  // same buyer assigned twice to the SAME agent in the window is one assigned
  // buyer for that agent. This is the agent's full worked book for the period.
  const stintRows = await prisma.buyerAssignment.findMany({
    where: {
      userId: { in: agentIds },
      assignedAt: win,
      buyer: { deletedAt: null, market },
    },
    select: { userId: true, buyerId: true },
  });
  // workedBuyers[agentId] = set of buyerIds the agent had a stint opened for in
  // the window. Drives buyersAssigned + the funnel denominator + avg attempts.
  const workedBuyers = new Map<string, Set<string>>();
  for (const id of agentIds) workedBuyers.set(id, new Set());
  for (const r of stintRows) {
    workedBuyers.get(r.userId)?.add(r.buyerId);
  }
  for (const a of agents) {
    const n = workedBuyers.get(a.id)?.size ?? 0;
    const m = byId.get(a.id)!;
    m.buyersAssigned = n;
    m.funnelAssigned = n;
  }

  // ── 2. RETURNS to the Admin Pool — closed stints in window, by reason ──
  // A stint that was returnedAt-in-window is a return event; attribute it to the
  // agent who held the stint (userId), split by returnReason. ADMIN_REASSIGN is
  // a manager-driven move (not the agent giving up) → not counted as either bucket.
  const [autoReturnRows, manualReturnRows] = await Promise.all([
    prisma.buyerAssignment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: agentIds },
        returnedAt: win,
        returnReason: BUYER_RETURN_REASON.AUTO_5_ATTEMPTS,
        buyer: { deletedAt: null, market },
      },
      _count: { _all: true },
    }),
    prisma.buyerAssignment.groupBy({
      by: ["userId"],
      where: {
        userId: { in: agentIds },
        returnedAt: win,
        returnReason: BUYER_RETURN_REASON.MANUAL_REJECT,
        buyer: { deletedAt: null, market },
      },
      _count: { _all: true },
    }),
  ]);
  applyGroupU(byId, autoReturnRows, (m, n) => (m.autoReturned = n));
  applyGroupU(byId, manualReturnRows, (m, n) => (m.manualReturned = n));

  // ── 3. OUTCOMES + ENGAGEMENT + ATTEMPTS — BuyerActivity by agent in window ──
  // Every metric here is a count of BuyerActivity rows authored by the agent
  // (userId) in the window, of a given type, on a non-deleted buyer. Converted /
  // Rejected are lifecycle rows the engine writes with the acting agent's id.
  const [
    convRows, rejRows, callRows, waRows, noteRows, voiceRows, attemptRows,
  ] = await Promise.all([
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.CONVERTED, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.REJECTED, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    // CALLS — from CallLog (buyer-linked), NOT BuyerActivity. See the single-source
    // note above: counting buyer calls from BuyerActivity too would double them.
    // `buyer:{deletedAt:null, market}` requires the buyer relation to exist, so this
    // matches exactly the buyer-linked rows for this market, and `startedAt` is the
    // same instant as the activity's createdAt (written in one tx).
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, startedAt: win, outcome: { in: CONNECTED_BUYER_CALL_OUTCOMES }, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.WHATSAPP, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.NOTE, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.VOICE_NOTE, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
    prisma.buyerActivity.groupBy({
      by: ["userId"],
      where: { userId: { in: agentIds }, type: { in: ATTEMPT_TYPE_LIST }, createdAt: win, buyer: { deletedAt: null, market } },
      _count: { _all: true },
    }),
  ]);
  applyGroupU(byId, convRows, (m, n) => (m.converted = n));
  applyGroupU(byId, rejRows, (m, n) => (m.rejected = n));
  applyGroupU(byId, callRows, (m, n) => (m.callsLogged = n));
  applyGroupU(byId, waRows, (m, n) => (m.whatsappInteractions = n));
  applyGroupU(byId, noteRows, (m, n) => (m.notesAdded = n));
  applyGroupU(byId, voiceRows, (m, n) => (m.voiceNotesAdded = n));
  applyGroupU(byId, attemptRows, (m, n) => (m.totalAttempts = n));

  // ── 4. CONVERSION FUNNEL — within the window's worked book ──
  // Denominator = the buyers the agent had a stint opened for in the window
  // (workedBuyers). For those exact buyers, how many got, IN THE WINDOW:
  //   • Contacted → >=1 contact activity (call/note/WA/voice/attempt)
  //   • Engaged   → >=1 CALL or WHATSAPP
  //   • Converted → a CONVERTED activity authored by this agent
  // We pull the distinct (userId, buyerId) pairs per stage and intersect with
  // the agent's worked set so a stage can never exceed Assigned.
  const [contactedPairs, engagedPairs, convertedPairs] = await Promise.all([
    prisma.buyerActivity.findMany({
      where: { userId: { in: agentIds }, type: { in: CONTACT_TYPE_LIST }, createdAt: win, buyer: { deletedAt: null, market } },
      select: { userId: true, buyerId: true },
      distinct: ["userId", "buyerId"],
    }),
    prisma.buyerActivity.findMany({
      where: { userId: { in: agentIds }, type: { in: ENGAGED_TYPE_LIST }, createdAt: win, buyer: { deletedAt: null, market } },
      select: { userId: true, buyerId: true },
      distinct: ["userId", "buyerId"],
    }),
    prisma.buyerActivity.findMany({
      where: { userId: { in: agentIds }, type: BUYER_ACTIVITY_TYPE.CONVERTED, createdAt: win, buyer: { deletedAt: null, market } },
      select: { userId: true, buyerId: true },
      distinct: ["userId", "buyerId"],
    }),
  ]);
  // Count only pairs whose buyer is in the agent's worked-in-window set, so each
  // funnel stage is a strict subset of Assigned (clean drop-off).
  const tallyFunnel = (
    pairs: Array<{ userId: string | null; buyerId: string }>,
    assign: (m: BuyerAgentMetrics, n: number) => void,
  ) => {
    const perAgent = new Map<string, number>();
    for (const p of pairs) {
      if (!p.userId) continue;
      const worked = workedBuyers.get(p.userId);
      if (!worked || !worked.has(p.buyerId)) continue;
      perAgent.set(p.userId, (perAgent.get(p.userId) ?? 0) + 1);
    }
    for (const [uid, n] of perAgent) {
      const m = byId.get(uid);
      if (m) assign(m, n);
    }
  };
  tallyFunnel(contactedPairs, (m, n) => (m.funnelContacted = n));
  tallyFunnel(engagedPairs, (m, n) => (m.funnelEngaged = n));
  tallyFunnel(convertedPairs, (m, n) => (m.funnelConverted = n));

  // Stable order: by agent name (matches scopedBuyerAgents()).
  return agents.map((a) => byId.get(a.id)!);
}

/** groupBy result applier — userId variant. */
function applyGroupU(
  byId: Map<string, BuyerAgentMetrics>,
  rows: Array<{ userId: string | null; _count: { _all: number } }>,
  set: (m: BuyerAgentMetrics, n: number) => void,
): void {
  for (const r of rows) {
    if (!r.userId) continue;
    const m = byId.get(r.userId);
    if (m) set(m, r._count._all);
  }
}

// ── Derived ratios ───────────────────────────────────────────────────────────

/** Average contact attempts per buyer worked (0 when no buyers worked). */
export function avgAttempts(m: BuyerAgentMetrics): number {
  return m.buyersAssigned > 0 ? m.totalAttempts / m.buyersAssigned : 0;
}
/** Conversion rate = converted ÷ buyers assigned (0 when none assigned). */
export function buyerConversionRate(m: BuyerAgentMetrics): number {
  return m.buyersAssigned > 0 ? (m.converted / m.buyersAssigned) * 100 : 0;
}
/** Contact rate = contacted ÷ assigned (funnel stage-1 %). */
export function buyerContactRate(m: BuyerAgentMetrics): number {
  return m.funnelAssigned > 0 ? (m.funnelContacted / m.funnelAssigned) * 100 : 0;
}
/** Total returns to pool (auto + manual). */
export function totalReturned(m: BuyerAgentMetrics): number {
  return m.autoReturned + m.manualReturned;
}

// ── Admin summary (top-of-report dashboard) ──────────────────────────────────
// Pipeline-wide counts (NOT windowed — these describe the current state of the
// whole pool, matching the agent-performance summary convention). Deleted always
// excluded. Honors the team scope (so a manager / team-filtered admin sees their
// slice). The window is reported in the page header but the summary is point-in-
// time pool health, like "stillActive" on the lead report.

export interface BuyerSummary {
  total: number; // all live buyer records
  assigned: number; // poolStatus ASSIGNED (currently being worked)
  unassigned: number; // poolStatus ADMIN_POOL (sitting in the pool)
  converted: number; // poolStatus CONVERTED
  rejected: number; // poolStatus REJECTED (terminal reject, distinct from returned-to-pool)
  returnedToPool: number; // returnedToPoolAt set AND currently back in the pool
  active: number; // currently ASSIGNED and not converted/rejected (== assigned, kept explicit)
}

/**
 * Build the admin summary. `teamOwnerIds` (optional) restricts to buyers owned by
 * a given set of agents (for a team-scoped admin / manager). When null, counts the
 * whole pool (the pool itself is owner-less, so it's only included in the unteam-
 * scoped total — a team filter naturally drops the unassigned pool, which is correct:
 * the pool is not any one team's).
 */
export async function buildBuyerSummary(teamOwnerIds: string[] | null, market: string = "Dubai"): Promise<BuyerSummary> {
  const ownerScope: Prisma.BuyerRecordWhereInput =
    teamOwnerIds === null ? {} : { ownerId: { in: teamOwnerIds } };
  // Market-scoped — the summary counts ONLY the given market's buyers (default Dubai).
  const base: Prisma.BuyerRecordWhereInput = { deletedAt: null, market, ...ownerScope };

  const [total, assigned, unassigned, converted, rejected, returnedToPool] = await Promise.all([
    prisma.buyerRecord.count({ where: base }),
    prisma.buyerRecord.count({ where: { ...base, poolStatus: "ASSIGNED" } }),
    // The unassigned Admin Pool is owner-less. Under a team filter (ownerScope set)
    // it would be 0; that's intentional — the pool belongs to no team.
    prisma.buyerRecord.count({ where: { ...base, poolStatus: "ADMIN_POOL" } }),
    prisma.buyerRecord.count({ where: { ...base, poolStatus: "CONVERTED" } }),
    prisma.buyerRecord.count({ where: { ...base, poolStatus: "REJECTED" } }),
    prisma.buyerRecord.count({ where: { ...base, returnedToPoolAt: { not: null }, poolStatus: "ADMIN_POOL" } }),
  ]);
  return { total, assigned, unassigned, converted, rejected, returnedToPool, active: assigned };
}

// ── Drill-down (reconciliation) ──────────────────────────────────────────────
// Every per-agent table metric maps to a key here. The detail page links to a
// filtered BuyerRecord list whose query == the metric's query, so "N records" on
// screen reconciles 1:1 with the count.
//
// Two attribution styles (must match buildBuyerReport exactly):
//   • STINT-history metrics (assigned + funnel stages) → BuyerRecord where the
//     agent has a stint/activity of the right kind in the window (buyer-level
//     fragment ANDed with the same population the count came from).
//   • EVENT metrics (converted/rejected/calls/wa/notes/voice/attempts/returns) →
//     BuyerRecord that has >=1 matching BuyerActivity/BuyerAssignment authored by
//     the agent in the window (records.some). The drill lists the DISTINCT buyers
//     behind the events; the raw event COUNT can exceed the buyer count (e.g. 3
//     calls to 1 buyer) — the drill page states this and also surfaces the event
//     tally so both numbers reconcile.

export type BuyerDrillKey =
  | "buyersAssigned"
  | "converted"
  | "rejected"
  | "autoReturned"
  | "manualReturned"
  | "callsLogged"
  | "whatsappInteractions"
  | "notesAdded"
  | "voiceNotesAdded"
  | "totalAttempts"
  | "funnelContacted"
  | "funnelEngaged"
  | "funnelConverted";

/** True when the metric is an EVENT count (rows) rather than a distinct-buyer
 *  count — so the drill page can show "X events across Y buyers". */
export const BUYER_EVENT_METRICS: ReadonlySet<BuyerDrillKey> = new Set<BuyerDrillKey>([
  "converted", "rejected", "autoReturned", "manualReturned",
  "callsLogged", "whatsappInteractions", "notesAdded", "voiceNotesAdded", "totalAttempts",
]);

/**
 * Build the exact Prisma where-clause for the BuyerRecords behind a metric, for a
 * given agent + window. Used by the drill-down page so the list it shows matches
 * the count (distinct buyers). Deleted excluded in every branch.
 */
export function buyerDrilldownWhere(
  key: BuyerDrillKey,
  agentId: string,
  range: DateRange,
  market: string = "Dubai",
): Prisma.BuyerRecordWhereInput {
  const win = { gte: range.gte, lt: range.lt };
  // Every drill-down lists ONLY the given market's buyers (default Dubai) so the
  // count on the report reconciles 1:1 with the market-scoped figure.
  const MARKET = market;
  // Helper: buyer has >=1 BuyerActivity of these type(s), by this agent, in window.
  const hasActivity = (types: string | string[]): Prisma.BuyerRecordWhereInput => ({
    deletedAt: null,
    market: MARKET,
    activities: {
      some: {
        userId: agentId,
        createdAt: win,
        type: Array.isArray(types) ? { in: types } : types,
      },
    },
  });
  switch (key) {
    case "buyersAssigned":
      // Stint opened in window, by this agent.
      return {
        deletedAt: null,
        market: MARKET,
        assignments: { some: { userId: agentId, assignedAt: win } },
      };
    case "converted":
      return hasActivity(BUYER_ACTIVITY_TYPE.CONVERTED);
    case "rejected":
      return hasActivity(BUYER_ACTIVITY_TYPE.REJECTED);
    case "autoReturned":
      return {
        deletedAt: null,
        market: MARKET,
        assignments: { some: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.AUTO_5_ATTEMPTS } },
      };
    case "manualReturned":
      return {
        deletedAt: null,
        market: MARKET,
        assignments: { some: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.MANUAL_REJECT } },
      };
    case "callsLogged":
      // Calls come from CallLog (buyer-linked), so the drill-down must too —
      // otherwise the list would not reconcile with the count. Single-source rule:
      // never resolve buyer calls through BuyerActivity (that would double-count).
      return {
        deletedAt: null,
        market: MARKET,
        callLogs: { some: { userId: agentId, startedAt: win, outcome: { in: CONNECTED_BUYER_CALL_OUTCOMES } } },
      };
    case "whatsappInteractions":
      return hasActivity(BUYER_ACTIVITY_TYPE.WHATSAPP);
    case "notesAdded":
      return hasActivity(BUYER_ACTIVITY_TYPE.NOTE);
    case "voiceNotesAdded":
      return hasActivity(BUYER_ACTIVITY_TYPE.VOICE_NOTE);
    case "totalAttempts":
      return hasActivity(ATTEMPT_TYPE_LIST);
    case "funnelContacted":
      // Buyer the agent BOTH had a stint opened for AND logged a contact activity
      // on, in the window (matches the funnel intersection).
      return {
        deletedAt: null,
        market: MARKET,
        AND: [
          { assignments: { some: { userId: agentId, assignedAt: win } } },
          { activities: { some: { userId: agentId, createdAt: win, type: { in: CONTACT_TYPE_LIST } } } },
        ],
      };
    case "funnelEngaged":
      return {
        deletedAt: null,
        market: MARKET,
        AND: [
          { assignments: { some: { userId: agentId, assignedAt: win } } },
          { activities: { some: { userId: agentId, createdAt: win, type: { in: ENGAGED_TYPE_LIST } } } },
        ],
      };
    case "funnelConverted":
      return {
        deletedAt: null,
        market: MARKET,
        AND: [
          { assignments: { some: { userId: agentId, assignedAt: win } } },
          { activities: { some: { userId: agentId, createdAt: win, type: BUYER_ACTIVITY_TYPE.CONVERTED } } },
        ],
      };
    default:
      return { deletedAt: null, market: MARKET, id: "__none__" }; // never matches
  }
}

/**
 * For EVENT metrics, the raw count of the underlying BuyerActivity /
 * BuyerAssignment rows (which can exceed the distinct-buyer count). Returns the
 * SAME number buildBuyerReport produced for that metric, so the drill page can
 * prove: report number == event count, and lists the distinct buyers behind it.
 */
export async function buyerEventCount(
  key: BuyerDrillKey,
  agentId: string,
  range: DateRange,
  market: string = "Dubai",
): Promise<number> {
  const win = { gte: range.gte, lt: range.lt };
  switch (key) {
    case "converted":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.CONVERTED, createdAt: win, buyer: { deletedAt: null, market } } });
    case "rejected":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.REJECTED, createdAt: win, buyer: { deletedAt: null, market } } });
    case "callsLogged":
      // CallLog is the single source for calls — must mirror buildBuyerReport's
      // query exactly so "N calls" on the report == N events on the drill page.
      return prisma.callLog.count({ where: { userId: agentId, startedAt: win, outcome: { in: CONNECTED_BUYER_CALL_OUTCOMES }, buyer: { deletedAt: null, market } } });
    case "whatsappInteractions":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.WHATSAPP, createdAt: win, buyer: { deletedAt: null, market } } });
    case "notesAdded":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.NOTE, createdAt: win, buyer: { deletedAt: null, market } } });
    case "voiceNotesAdded":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.VOICE_NOTE, createdAt: win, buyer: { deletedAt: null, market } } });
    case "totalAttempts":
      return prisma.buyerActivity.count({ where: { userId: agentId, type: { in: ATTEMPT_TYPE_LIST }, createdAt: win, buyer: { deletedAt: null, market } } });
    case "autoReturned":
      return prisma.buyerAssignment.count({ where: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.AUTO_5_ATTEMPTS, buyer: { deletedAt: null, market } } });
    case "manualReturned":
      return prisma.buyerAssignment.count({ where: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.MANUAL_REJECT, buyer: { deletedAt: null, market } } });
    default:
      // Distinct-buyer metrics: the event count == the drill record count.
      return prisma.buyerRecord.count({ where: buyerDrilldownWhere(key, agentId, range) });
  }
}

/** Human label for a drill-down key — used on the filtered-list page header. */
export const BUYER_DRILL_LABELS: Record<BuyerDrillKey, string> = {
  buyersAssigned: "Buyer Records Assigned",
  converted: "Buyers Converted To Leads",
  rejected: "Buyers Rejected",
  autoReturned: "Auto-Returned To Pool (5 attempts)",
  manualReturned: "Manually Returned To Pool",
  callsLogged: "Calls Logged",
  whatsappInteractions: "WhatsApp Interactions",
  notesAdded: "Notes Added",
  voiceNotesAdded: "Voice Notes Added",
  totalAttempts: "Contact Attempts",
  funnelContacted: "Funnel — Contacted",
  funnelEngaged: "Funnel — Engaged",
  funnelConverted: "Funnel — Converted",
};

// ── Export columns (single source of truth for CSV/Excel + on-screen table) ───

export interface BuyerMetricColumn {
  key: string;
  label: string;
  group: string;
  get: (m: BuyerAgentMetrics) => number | string;
}

export const BUYER_METRIC_COLUMNS: BuyerMetricColumn[] = [
  { key: "agent", label: "Agent", group: "", get: (m) => m.agentName },
  { key: "team", label: "Team", group: "", get: (m) => m.team ?? "" },
  // Assignment
  { key: "buyersAssigned", label: "Buyer Records Assigned", group: "Assignment", get: (m) => m.buyersAssigned },
  // Outcomes
  { key: "converted", label: "Converted To Leads", group: "Outcomes", get: (m) => m.converted },
  { key: "rejected", label: "Rejected", group: "Outcomes", get: (m) => m.rejected },
  { key: "autoReturned", label: "Auto-Returned (5 attempts)", group: "Outcomes", get: (m) => m.autoReturned },
  { key: "manualReturned", label: "Manually Returned", group: "Outcomes", get: (m) => m.manualReturned },
  // Contact activity
  { key: "callsLogged", label: "Calls Logged", group: "Contact Activity", get: (m) => m.callsLogged },
  { key: "whatsappInteractions", label: "WhatsApp Interactions", group: "Contact Activity", get: (m) => m.whatsappInteractions },
  { key: "notesAdded", label: "Notes Added", group: "Contact Activity", get: (m) => m.notesAdded },
  { key: "voiceNotesAdded", label: "Voice Notes Added", group: "Contact Activity", get: (m) => m.voiceNotesAdded },
  // Attempts
  { key: "totalAttempts", label: "Total Attempts", group: "Attempts", get: (m) => m.totalAttempts },
  { key: "avgAttempts", label: "Avg Attempts / Buyer", group: "Attempts", get: (m) => avgAttempts(m).toFixed(2) },
  // Funnel
  { key: "funnelAssigned", label: "Funnel: Assigned", group: "Funnel", get: (m) => m.funnelAssigned },
  { key: "funnelContacted", label: "Funnel: Contacted", group: "Funnel", get: (m) => m.funnelContacted },
  { key: "funnelEngaged", label: "Funnel: Engaged", group: "Funnel", get: (m) => m.funnelEngaged },
  { key: "funnelConverted", label: "Funnel: Converted", group: "Funnel", get: (m) => m.funnelConverted },
  // Derived
  { key: "conversionRate", label: "Conversion %", group: "Derived", get: (m) => buyerConversionRate(m).toFixed(1) },
  { key: "contactRate", label: "Contact %", group: "Derived", get: (m) => buyerContactRate(m).toFixed(1) },
];

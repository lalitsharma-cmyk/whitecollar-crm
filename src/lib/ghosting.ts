// ═════════════════════════════════════════════════════════════════════════════
// 👻 GHOSTING — pure classification half of the owner-specific call-attempt
// cycle (Lalit 2026-07-17). NO prisma / server imports, so the shared filter
// engine (leadFilterWhere), client components, reports, and the regression
// suite can all import it. The write path lives in lib/callAttempts.ts (which
// re-exports everything here — import from either).
//
// Rule: a NORMAL lead (not Revival/cold) whose CURRENT owner logged ≥ threshold
// call attempts with ZERO meaningful connects, while the status is workable and
// not "engaged" (meeting/visit booked), is tagged 👻 Ghosting — a SECONDARY tag
// that never replaces the status. Transfer or a connect clears it.
// ═════════════════════════════════════════════════════════════════════════════
import { TERMINAL_STATUSES, CLOSING_STATUSES } from "@/lib/lead-statuses";
import { isRevivalOrigin } from "@/lib/moduleSource";

export const MEANINGFUL_CALL_OUTCOMES = [
  "CONNECTED",
  "CALLBACK",
  "INTERESTED",
  "NOT_INTERESTED",
] as const;

export const GHOSTING_DEFAULT_THRESHOLD = 10;
export const REVIVAL_DEFAULT_MAX_ATTEMPTS = 5;

export function isMeaningfulOutcome(outcome: string | null | undefined): boolean {
  return !!outcome && (MEANINGFUL_CALL_OUTCOMES as readonly string[]).includes(outcome);
}

// ═══ PENDING (unresolved) CALL STATES — Lalit P0, 2026-07-18 ═════════════════
// Every "Call" button now writes a CallLog IMMEDIATELY on dial, before any
// result exists. Such a row is a DIAL, not an outcome:
//
//   INITIATED — the agent tapped Call; nothing has happened yet.
//   RINGING   — the line is ringing; still no result.
//
// A pending row MUST NOT count as an attempt or as a completed call, anywhere:
//   • 👻 Ghosting would tag leads at 10 TAPS instead of 10 real attempts;
//   • ↩︎ Revival auto-return would yank records out of an agent's queue at 5 taps;
//   • call totals / connected-vs-missed / leaderboards / agent performance
//     would inflate by every dial that never resolved.
// The SAME row is later transitioned to a terminal outcome (one dial = one row),
// and it is that TRANSITION — not the dial — that advances the attempt cycle.
//
// Everything not listed here is TERMINAL and counts normally (CONNECTED also
// means "Completed", NOT_PICKED also means "No Answer", plus FAILED / CANCELLED
// / MISSED / BUSY / SWITCHED_OFF / WRONG_NUMBER / CALLBACK / INTERESTED /
// NOT_INTERESTED). Defined here (pure, prisma-free) so the write path, reports,
// dashboards and client components all share ONE definition.
//
// THIS IS THE SINGLE DEFINITION. src/lib/callLogService.ts RE-EXPORTS from here
// (it briefly carried its own copy, written in parallel; reconciled 2026-07-18)
// and a regression invariant asserts the two never diverge again — two
// definitions of "pending" that can drift apart is exactly how the ghosting
// engine would start counting taps as attempts.
//
// The dependency direction is forced and must NOT be inverted: this module is
// deliberately prisma-free and is imported by lib/leadFilterWhere.ts (shared with
// the client filter panel), client components and the regression suite, whereas
// callLogService.ts imports `prisma` and `buyerLifecycle`. Importing it here
// would drag the Prisma client into the browser bundle and break the build.
//
// Typed as a mutable string-literal Array (not `as const`) so it drops straight
// into a Prisma `outcome: { notIn: … }`, which requires a mutable CallOutcome[]
// — the same pattern as BUYER_CONNECTED_CALL_OUTCOMES in lib/dashboardWidgets.ts.
// NULL-SAFETY: CallLog.outcome is NOT NULL in the schema, so unlike the
// GHOSTING_DISPLAY_WHERE case below, a bare `notIn` cannot silently drop rows
// via Postgres three-valued logic. No null legs are needed.
export const PENDING_CALL_OUTCOMES: Array<"INITIATED" | "RINGING"> = ["INITIATED", "RINGING"];

/** True for a dial with no result yet (INITIATED / RINGING). Never an attempt,
 *  never a completed call. The ONE predicate every call metric must consult. */
export function isPendingCall(outcome: string | null | undefined): boolean {
  return !!outcome && (PENDING_CALL_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * How long a PENDING row stays claimable by a later "log the call" write. An
 * agent taps Call, talks, then writes it up — usually within a few minutes. 30
 * min covers a long conversation plus write-up, and is short enough that a
 * forgotten dial from this morning is never retro-attached to an unrelated
 * evening call (which would silently rewrite history).
 *
 * Lives HERE, not in callLogService.ts, purely to break an import cycle:
 * callLogService imports buyerPrimaryPhone from buyerLifecycle, so
 * buyerLifecycle cannot import back from callLogService. Both import this
 * prisma-free module instead, which keeps ONE definition of the window rather
 * than a copy in each — a drifted window would make buyer and lead calls claim
 * pending rows under different rules.
 */
export const PENDING_RESOLVE_WINDOW_MIN = 30;

/** Prisma where-fragment excluding unresolved dials from a CallLog query.
 *  Returns a FRESH object each call (no shared-reference aliasing between
 *  where-inputs — the trap documented on GHOSTING_DISPLAY_WHERE below).
 *  Spread it: `where: { ...excludePendingCallsWhere(), userId }`. */
export function excludePendingCallsWhere(): { outcome: { notIn: Array<"INITIATED" | "RINGING"> } } {
  return { outcome: { notIn: [...PENDING_CALL_OUTCOMES] } };
}

/** Statuses that BLOCK the ghosting tag: the deal is over (terminal) or the client
 *  is actively engaged (meeting/visit scheduled — CLOSING set). "Follow Up" is NOT
 *  blocked — Lalit's explicit example shows 👻 alongside a Follow Up status (an
 *  agent can schedule follow-ups against a phone that never answers). */
export function ghostingBlockedStatus(status: string | null | undefined): boolean {
  if (!status) return false; // no status = still workable = eligible
  return TERMINAL_STATUSES.includes(status) || CLOSING_STATUSES.includes(status);
}

/** Stamp-time eligibility (normal leads). Pure — threshold passed in. */
export function isGhostingEligible(
  lead: {
    ownerId: string | null;
    leadOrigin?: string | null;
    attemptCount: number;
    connectedCount: number;
    currentStatus: string | null;
  },
  threshold: number,
): boolean {
  return (
    !!lead.ownerId &&
    !isRevivalOrigin(lead.leadOrigin) &&
    lead.attemptCount >= threshold &&
    lead.connectedCount === 0 &&
    !ghostingBlockedStatus(lead.currentStatus)
  );
}

/** Read-time display/filter guard: a stamped lead stops SHOWING as ghosting the
 *  moment its status turns terminal/engaged or it loses its owner — no write
 *  needed. Every 👻 surface (tag, filter, report, dashboard) must use this. */
export function isGhostingDisplay(lead: {
  ghostingAt: Date | string | null;
  ownerId: string | null;
  currentStatus: string | null;
}): boolean {
  return !!lead.ghostingAt && !!lead.ownerId && !ghostingBlockedStatus(lead.currentStatus);
}

/** The SQL twin of isGhostingDisplay — AND this into any Prisma where for
 *  ghosting counts/filters so report numbers == drill rows (count==records).
 *  NULL-SAFE: Postgres `NOT IN (...)` evaluates to NULL (not true) for a NULL
 *  column, which would silently DROP null/blank-status ghosting leads — but a
 *  null status is ghosting-ELIGIBLE (ghostingBlockedStatus returns false for it),
 *  so the pure guard would count them while a bare notIn would not. The explicit
 *  null/"" legs keep the SQL twin identical to isGhostingDisplay. */
// NOTE: no `as const` — Prisma where-inputs need mutable arrays; a fresh getter
// avoids the shared-readonly-reference the routing widget hit. Exported as a plain
// object (spread at each use) so callers get a shallow copy of the top level.
export const GHOSTING_DISPLAY_WHERE: {
  ghostingAt: { not: null };
  ownerId: { not: null };
  OR: Array<{ currentStatus: null } | { currentStatus: "" } | { currentStatus: { notIn: string[] } }>;
} = {
  ghostingAt: { not: null },
  ownerId: { not: null },
  OR: [
    { currentStatus: null },
    { currentStatus: "" },
    { currentStatus: { notIn: [...TERMINAL_STATUSES, ...CLOSING_STATUSES] } },
  ],
};

/** Reset payload for an ownership change — spread into the lead.update in
 *  assignLeadTo (THE single assignment choke point). New owner, fresh cycle. */
export function resetAttemptCycleData() {
  return {
    attemptCount: 0,
    connectedCount: 0,
    lastAttemptAt: null,
    lastAttemptById: null,
    ghostingAt: null,
  };
}

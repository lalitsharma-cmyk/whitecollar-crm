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

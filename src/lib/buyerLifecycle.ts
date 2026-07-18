// ────────────────────────────────────────────────────────────────────────────
// buyerLifecycle.ts — the shared engine for the Buyer Data worked pipeline.
//
// BuyerRecord moves through: ADMIN_POOL → ASSIGNED → (CONVERTED | back to
// ADMIN_POOL via reject/auto-return). Every transition writes:
//   • a BuyerAssignment "stint" row (opened on assign, closed on return), and
//   • a BuyerActivity timeline row (ASSIGNED / RETURNED / CONVERTED / REJECTED /
//     CALL / NOTE / WHATSAPP / VOICE_NOTE / ATTEMPT_*),
// so the agent-handling history + conversation timeline are always complete and
// survive reassignment (history is NEVER deleted when a buyer goes back to pool).
//
// The routes stay thin: they authenticate + authorize, then call these helpers
// inside their own prisma transaction. Helpers take a transaction client (`tx`)
// so a whole transition is atomic. Pure-ish: no requireUser / no NextResponse —
// callable from the regression harness + the E2E proof.
// ────────────────────────────────────────────────────────────────────────────

import type { Prisma } from "@prisma/client";
// Both are PURE modules (no "server-only", no prisma runtime import) — safe here
// because a client component (BuyerAdminPanel) imports this file for its constants.
// NEVER add a VALUE import of @prisma/client to this module for the same reason;
// enum columns are written as string literals (Prisma generates them as string
// unions, so "CONNECTED" / "OUTBOUND" typecheck against CallOutcome/CallDirection).
import { parseJsonArray } from "@/lib/buyerIntelligence";
import { toE164 } from "@/lib/phone";

/** poolStatus values. Kept as plain strings (column is TEXT) so adding a state
 *  never needs a migration. */
export const BUYER_POOL_STATUS = {
  ADMIN_POOL: "ADMIN_POOL",
  ASSIGNED: "ASSIGNED",
  CONVERTED: "CONVERTED",
  REJECTED: "REJECTED",
} as const;
export type BuyerPoolStatus = (typeof BUYER_POOL_STATUS)[keyof typeof BUYER_POOL_STATUS];

/** BuyerAssignment.returnReason values. */
export const BUYER_RETURN_REASON = {
  MANUAL_REJECT: "MANUAL_REJECT",     // stint closed because the buyer was REJECTED (terminal)
  AUTO_5_ATTEMPTS: "AUTO_5_ATTEMPTS", // auto-returned to pool after 5 attempts (still active)
  ADMIN_REASSIGN: "ADMIN_REASSIGN",   // stint closed to hand the buyer to another agent
  RETURN_TO_POOL: "RETURN_TO_POOL",   // manual "Return to Pool" (still active, distinct from reject)
} as const;
export type BuyerReturnReason = (typeof BUYER_RETURN_REASON)[keyof typeof BUYER_RETURN_REASON];

/** BuyerActivity.type values. */
export const BUYER_ACTIVITY_TYPE = {
  CALL: "CALL",
  NOTE: "NOTE",
  WHATSAPP: "WHATSAPP",
  VOICE_NOTE: "VOICE_NOTE",
  ATTEMPT_NO_ANSWER: "ATTEMPT_NO_ANSWER",
  ATTEMPT_NOT_PICKED: "ATTEMPT_NOT_PICKED",
  ATTEMPT_WA_NO_RESPONSE: "ATTEMPT_WA_NO_RESPONSE",
  ASSIGNED: "ASSIGNED",
  RETURNED: "RETURNED",
  CONVERTED: "CONVERTED",
  REJECTED: "REJECTED",
  // Follow-up lifecycle (buyer parity with the Lead follow-up bar). Written by the
  // buyer action-complete / action-snooze / action-escalate endpoints, NOT the
  // generic /activity logger. Plain strings — the type column is TEXT so these add
  // no migration.
  COMPLETED: "COMPLETED",
  SNOOZED: "SNOOZED",
  ESCALATED: "ESCALATED",
  // Terminal reject + its reversal (AI Reactivation flow). Plain strings — TEXT column.
  REACTIVATED: "REACTIVATED",
} as const;
export type BuyerActivityType = (typeof BUYER_ACTIVITY_TYPE)[keyof typeof BUYER_ACTIVITY_TYPE];

/** The activity types that count as a "contact attempt" (increment attemptCount
 *  and trigger the auto-return-at-5 rule). */
export const ATTEMPT_TYPES: ReadonlySet<string> = new Set([
  BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED,
  BUYER_ACTIVITY_TYPE.ATTEMPT_WA_NO_RESPONSE,
]);

// ── CENTRAL CALL LOG — the single source of truth for CALLS ──────────────────
// SINGLE-SOURCE RULE (2026-07-18): a buyer phone call now ALSO writes a row into
// the central `CallLog` table (buyerId set, leadId null) — exactly like a Lead
// call does via /api/leads/[id]/log-call. CallLog is therefore the ONE place every
// call in the CRM lives (Leads · Master Data · Revival · Buyer Data).
//
// ⚠️ NEVER COUNT BUYER CALLS FROM BuyerActivity AGAIN — that would DOUBLE-COUNT
// them, because the same call is now a CallLog row too. The BuyerActivity row is
// retained ONLY to render the buyer conversation timeline. Every call-count read
// (agentPerformance / dashboardWidgets / buyerPerformance) sources buyer calls
// from CallLog where buyerId is not null.

/** Buyer activity types that represent a REAL PHONE CALL and so also write a
 *  CallLog row. = ATTEMPT_TYPES + plain CALL, MINUS ATTEMPT_WA_NO_RESPONSE:
 *  a WhatsApp non-response is a messaging event, not a phone call, so it stays an
 *  attempt on BuyerActivity only (it still increments attemptCount as before). */
export const CALL_LOGGED_TYPES: ReadonlySet<string> = new Set([
  BUYER_ACTIVITY_TYPE.CALL,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED,
]);

/** BuyerActivity.type → CallLog.outcome. A manually-logged CALL means the agent
 *  reached the buyer (the UI logs the ATTEMPT_* types when they did not), so
 *  CALL → CONNECTED and both attempt types → NOT_PICKED. Kept as string literals:
 *  Prisma generates CallOutcome as a string union, so these typecheck without a
 *  runtime @prisma/client import. The historical backfill MUST use this same map
 *  or the post-backfill totals will not reconcile. */
export const CALL_OUTCOME_BY_ACTIVITY_TYPE: Record<string, "CONNECTED" | "NOT_PICKED"> = {
  [BUYER_ACTIVITY_TYPE.CALL]: "CONNECTED",
  [BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER]: "NOT_PICKED",
  [BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED]: "NOT_PICKED",
};

/** Best-effort primary phone for a buyer's CallLog row. phones is a JSON array
 *  string; take the first entry, normalised to E.164 when possible. NEVER throws
 *  and NEVER returns empty — CallLog.phoneNumber is NOT NULL, and an unresolvable
 *  number must not break the contact flow, so it falls back to a placeholder. */
export function buyerPrimaryPhone(phones: unknown): string {
  try {
    const first = parseJsonArray(phones)[0];
    if (!first) return "(no number)";
    return toE164(first) ?? first;
  } catch {
    return "(no number)";
  }
}

/** The activity types an agent may log via the /activity endpoint (lifecycle
 *  transitions ASSIGNED/RETURNED/CONVERTED/REJECTED are written by the engine,
 *  not user-logged). */
export const LOGGABLE_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  BUYER_ACTIVITY_TYPE.CALL,
  BUYER_ACTIVITY_TYPE.NOTE,
  BUYER_ACTIVITY_TYPE.WHATSAPP,
  BUYER_ACTIVITY_TYPE.VOICE_NOTE,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED,
  BUYER_ACTIVITY_TYPE.ATTEMPT_WA_NO_RESPONSE,
]);

/** Contact-type activities that satisfy the "logged a touch today" completion gate
 *  (parity with the Lead followup gate — see src/lib/buyerFollowup.ts). NOTE-only
 *  does NOT count as a contact, so an agent can't complete a follow-up on a bare note. */
export const CONTACT_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  BUYER_ACTIVITY_TYPE.CALL,
  BUYER_ACTIVITY_TYPE.WHATSAPP,
  BUYER_ACTIVITY_TYPE.VOICE_NOTE,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED,
  BUYER_ACTIVITY_TYPE.ATTEMPT_WA_NO_RESPONSE,
]);

/** The attempt count at which a buyer is automatically returned to the Admin Pool. */
export const AUTO_RETURN_ATTEMPTS = 5;

// A minimal transaction-client type: any object exposing the three buyer models
// + their methods we use. Prisma.TransactionClient satisfies it; so does the base
// PrismaClient (for non-transactional callers).
type Tx = Prisma.TransactionClient;

/** Log one BuyerActivity row. */
export async function logBuyerActivity(
  tx: Tx,
  buyerId: string,
  userId: string | null,
  type: BuyerActivityType | string,
  description?: string | null,
): Promise<void> {
  await tx.buyerActivity.create({
    data: { buyerId, userId: userId ?? null, type, description: description ?? null },
  });
}

/** Find the currently-OPEN assignment stint for a buyer (returnedAt = null), if any. */
export async function openStint(tx: Tx, buyerId: string) {
  return tx.buyerAssignment.findFirst({
    where: { buyerId, returnedAt: null },
    orderBy: { assignedAt: "desc" },
  });
}

/**
 * Assign a pool buyer to an agent. Sets ownership, opens a stint, logs ASSIGNED.
 * Idempotent-safe: if an open stint already exists for a DIFFERENT owner it is
 * closed (ADMIN_REASSIGN) before the new one opens. Returns the new stint id.
 * Caller is responsible for the notify() (it's a side-effect outside the tx).
 */
export async function assignBuyerInTx(
  tx: Tx,
  buyerId: string,
  agentId: string,
  assignedById: string | null,
): Promise<{ stintId: string }> {
  const now = new Date();
  // Close any stale open stint (defensive — a clean pool buyer has none).
  const open = await openStint(tx, buyerId);
  if (open && open.userId !== agentId) {
    await tx.buyerAssignment.update({
      where: { id: open.id },
      data: { returnedAt: now, returnReason: BUYER_RETURN_REASON.ADMIN_REASSIGN },
    });
    await logBuyerActivity(tx, buyerId, assignedById, BUYER_ACTIVITY_TYPE.RETURNED, "Reassigned by admin");
  }
  await tx.buyerRecord.update({
    where: { id: buyerId },
    data: {
      ownerId: agentId,
      assignedAt: now,
      poolStatus: BUYER_POOL_STATUS.ASSIGNED,
      // A fresh stint starts the attempt clock over for the new agent.
      attemptCount: 0,
      // Clear any prior terminal markers — the buyer is live again.
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
      rejectCategory: null,
    },
  });
  const stint = await tx.buyerAssignment.create({
    data: { buyerId, userId: agentId, assignedById, attemptsInStint: 0 },
  });
  await logBuyerActivity(tx, buyerId, assignedById, BUYER_ACTIVITY_TYPE.ASSIGNED, `Assigned to agent`);
  return { stintId: stint.id };
}

/**
 * Return a buyer to the Admin Pool. Clears ownership, sets poolStatus=ADMIN_POOL,
 * closes the open stint with the given reason, stamps rejection/return fields, and
 * logs REJECTED + RETURNED. RETAINS all remarks + activity/assignment history.
 * Used by BOTH the manual reject endpoint (MANUAL_REJECT) and the auto-return rule
 * (AUTO_5_ATTEMPTS). `actorId` = the agent (manual) or null (system/auto).
 */
export async function returnBuyerToPoolInTx(
  tx: Tx,
  buyerId: string,
  reason: BuyerReturnReason,
  actorId: string | null,
  rejectionReason?: string | null,
): Promise<void> {
  const now = new Date();
  const open = await openStint(tx, buyerId);
  if (open) {
    await tx.buyerAssignment.update({
      where: { id: open.id },
      data: { returnedAt: now, returnReason: reason },
    });
  }
  await tx.buyerRecord.update({
    where: { id: buyerId },
    data: {
      ownerId: null,
      assignedAt: null,
      poolStatus: BUYER_POOL_STATUS.ADMIN_POOL,
      returnedToPoolAt: now,
      // A return to pool is NOT a reject — the buyer stays ACTIVE, just unassigned.
      // Reject-audit fields belong ONLY to rejectBuyerInTx (terminal). Clear any
      // stale reject markers so a re-pooled buyer reads cleanly as an active record.
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
      rejectCategory: null,
      // attemptCount is intentionally LEFT as-is on the record for the audit trail
      // of "this buyer has been hard to reach"; the next assignment resets it.
    },
  });
  const isAuto = reason === BUYER_RETURN_REASON.AUTO_5_ATTEMPTS;
  await logBuyerActivity(
    tx, buyerId, actorId, BUYER_ACTIVITY_TYPE.RETURNED,
    isAuto ? `Auto-returned to pool (${AUTO_RETURN_ATTEMPTS} attempts)` : (rejectionReason ? `Returned to pool: ${rejectionReason}` : "Returned to Admin Buyer Pool"),
  );
}

/**
 * TERMINAL REJECT — the buyer leaves the working pipeline entirely (parity with a
 * rejected Lead). Sets poolStatus=REJECTED, clears ownerId (removed from the agent
 * queue + the active/working list), closes the open stint (MANUAL_REJECT), and
 * stamps the FULL reject audit (reason + category + who + when + AI-revival
 * eligibility). This is DISTINCT from returnBuyerToPoolInTx: a rejected buyer does
 * NOT go back to the Admin Pool and is NEVER auto-reassigned — it sits in the
 * Rejected tab until an admin explicitly REACTIVATES it (the AI Reactivation flow:
 * Rejected → recommendation → admin approval → reactivate → assign). History is
 * never deleted — the timeline retains every prior activity + the reject event.
 */
export async function rejectBuyerInTx(
  tx: Tx,
  buyerId: string,
  actorId: string | null,
  opts: { reason?: string | null; category?: string | null; aiEligibleForRevival?: boolean | null } = {},
): Promise<void> {
  const now = new Date();
  const open = await openStint(tx, buyerId);
  if (open) {
    await tx.buyerAssignment.update({
      where: { id: open.id },
      data: { returnedAt: now, returnReason: BUYER_RETURN_REASON.MANUAL_REJECT },
    });
  }
  await tx.buyerRecord.update({
    where: { id: buyerId },
    data: {
      ownerId: null,
      assignedAt: null,
      poolStatus: BUYER_POOL_STATUS.REJECTED, // TERMINAL — not ADMIN_POOL
      rejectedAt: now,
      rejectedById: actorId,
      rejectionReason: opts.reason ?? null,
      rejectCategory: opts.category ?? null,
      aiEligibleForRevival: opts.aiEligibleForRevival ?? null,
      // returnedToPoolAt is intentionally NOT set — a reject is not a pool return.
    },
  });
  const bits = [
    opts.category ? `[${opts.category}]` : null,
    opts.reason ?? null,
    opts.aiEligibleForRevival ? "AI-revival-eligible" : null,
  ].filter(Boolean).join(" · ");
  await logBuyerActivity(tx, buyerId, actorId, BUYER_ACTIVITY_TYPE.REJECTED, `Rejected${bits ? `: ${bits}` : ""}`);
}

/**
 * REACTIVATE a REJECTED buyer → back to the Admin Pool, clearing the terminal
 * markers so it can be assigned again. The entry point for the AI Reactivation
 * Engine (admin-approved). The reject audit is preserved in the timeline (the
 * REJECTED + REACTIVATED BuyerActivity rows), so "reactivated history" is never
 * lost; aiEligibleForRevival is left on the record as the historical assessment.
 */
export async function reactivateBuyerInTx(
  tx: Tx,
  buyerId: string,
  actorId: string | null,
  note?: string | null,
): Promise<void> {
  const now = new Date();
  await tx.buyerRecord.update({
    where: { id: buyerId },
    data: {
      poolStatus: BUYER_POOL_STATUS.ADMIN_POOL,
      ownerId: null,
      assignedAt: null,
      rejectedAt: null,
      rejectedById: null,
      rejectionReason: null,
      rejectCategory: null,
      returnedToPoolAt: now,
    },
  });
  await logBuyerActivity(tx, buyerId, actorId, BUYER_ACTIVITY_TYPE.REACTIVATED, `Reactivated to Admin Pool${note ? `: ${note}` : ""}`);
}

/**
 * Log a contact activity/attempt for an ASSIGNED buyer. For attempt types,
 * increments attemptCount + the open stint's attemptsInStint, and when
 * attemptCount reaches AUTO_RETURN_ATTEMPTS, AUTO-RETURNS the buyer to the pool
 * (event-driven — no cron). Returns the resulting state so the route can shape a
 * response and decide whether to notify the admin pool.
 *
 * Returns: { attemptCount, autoReturned } — autoReturned true ⇒ the buyer is now
 * back in ADMIN_POOL and the open stint is closed AUTO_5_ATTEMPTS.
 */
export async function logBuyerContactInTx(
  tx: Tx,
  buyerId: string,
  actorId: string | null,
  type: BuyerActivityType | string,
  description?: string | null,
): Promise<{ attemptCount: number; autoReturned: boolean }> {
  const buyer = await tx.buyerRecord.findUniqueOrThrow({
    where: { id: buyerId },
    // phones: needed for the CallLog row below — read in the SAME tx so the whole
    // contact write (activity + call log + counter) is one atomic unit.
    select: { attemptCount: true, phones: true },
  });
  const now = new Date();

  const isAttempt = ATTEMPT_TYPES.has(type);
  // Always write the activity row first (the timeline records every interaction).
  await logBuyerActivity(tx, buyerId, actorId, type, description);

  // ── CENTRAL CallLog row for real phone calls ───────────────────────────────
  // Buyer calls now live in CallLog (see CALL_LOGGED_TYPES above) so they surface
  // in the central Call Logs alongside Leads/Master Data/Revival calls. Same `tx`
  // ⇒ atomic with the activity + attemptCount. NEVER count these from
  // BuyerActivity as well — that would double-count every buyer call.
  if (CALL_LOGGED_TYPES.has(type)) {
    await tx.callLog.create({
      data: {
        buyerId,
        leadId: null,
        userId: actorId,
        direction: "OUTBOUND",
        phoneNumber: buyerPrimaryPhone(buyer.phones),
        outcome: CALL_OUTCOME_BY_ACTIVITY_TYPE[type] ?? "CONNECTED",
        notes: description ?? undefined,
        startedAt: now,
      },
    });
  }

  if (!isAttempt) {
    return { attemptCount: buyer.attemptCount, autoReturned: false };
  }

  const newCount = buyer.attemptCount + 1;
  await tx.buyerRecord.update({
    where: { id: buyerId },
    data: { attemptCount: newCount },
  });
  // Bump the open stint's attempt tally (best-effort — a buyer being worked has one).
  const open = await openStint(tx, buyerId);
  if (open) {
    await tx.buyerAssignment.update({
      where: { id: open.id },
      data: { attemptsInStint: { increment: 1 } },
    });
  }

  if (newCount >= AUTO_RETURN_ATTEMPTS) {
    await returnBuyerToPoolInTx(tx, buyerId, BUYER_RETURN_REASON.AUTO_5_ATTEMPTS, null);
    return { attemptCount: newCount, autoReturned: true };
  }
  return { attemptCount: newCount, autoReturned: false };
}

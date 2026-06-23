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
  MANUAL_REJECT: "MANUAL_REJECT",
  AUTO_5_ATTEMPTS: "AUTO_5_ATTEMPTS",
  ADMIN_REASSIGN: "ADMIN_REASSIGN",
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
} as const;
export type BuyerActivityType = (typeof BUYER_ACTIVITY_TYPE)[keyof typeof BUYER_ACTIVITY_TYPE];

/** The activity types that count as a "contact attempt" (increment attemptCount
 *  and trigger the auto-return-at-5 rule). */
export const ATTEMPT_TYPES: ReadonlySet<string> = new Set([
  BUYER_ACTIVITY_TYPE.ATTEMPT_NO_ANSWER,
  BUYER_ACTIVITY_TYPE.ATTEMPT_NOT_PICKED,
  BUYER_ACTIVITY_TYPE.ATTEMPT_WA_NO_RESPONSE,
]);

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
      rejectedAt: now,
      rejectedById: actorId,
      rejectionReason: rejectionReason ?? (reason === BUYER_RETURN_REASON.AUTO_5_ATTEMPTS ? "Auto-returned after 5 contact attempts" : null),
      returnedToPoolAt: now,
      // attemptCount is intentionally LEFT as-is on the record for the audit trail
      // of "this buyer has been hard to reach"; the next assignment resets it.
    },
  });
  const isAuto = reason === BUYER_RETURN_REASON.AUTO_5_ATTEMPTS;
  await logBuyerActivity(
    tx, buyerId, actorId, BUYER_ACTIVITY_TYPE.REJECTED,
    isAuto ? `Auto-returned to pool (${AUTO_RETURN_ATTEMPTS} attempts)` : (rejectionReason ? `Rejected: ${rejectionReason}` : "Rejected / returned to pool"),
  );
  await logBuyerActivity(tx, buyerId, actorId, BUYER_ACTIVITY_TYPE.RETURNED, "Returned to Admin Buyer Pool");
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
    select: { attemptCount: true },
  });

  const isAttempt = ATTEMPT_TYPES.has(type);
  // Always write the activity row first (the timeline records every interaction).
  await logBuyerActivity(tx, buyerId, actorId, type, description);

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

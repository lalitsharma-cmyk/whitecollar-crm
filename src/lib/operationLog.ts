import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";

// ─────────────────────────────────────────────────────────────────────────────
// OPERATION LOG — reversible structural operations (Lalit 2026-07-08).
//
// One shared helper for every structural admin action (transfer / edit-field /
// convert / assignment, single + bulk, all modules). On execute it snapshots the
// EXACT pre-op state of the affected rows; revertOperation() replays that snapshot
// so an accidental action can be undone atomically without DB surgery.
//
// Design mirrors the AssistantRun preview→execute→undo pattern already in the app.
// Revert restores ONLY the fields the op changed (so a later, unrelated edit by
// someone else is never clobbered), and reconciles buyer assignment stints so the
// pool/ownership history stays honest.
// ─────────────────────────────────────────────────────────────────────────────

export type OperationType =
  | "buyer.transfer"
  | "buyer.edit"
  | "buyer.convert"
  | "lead.transfer"
  | "lead.edit";

type DB = typeof prisma | Prisma.TransactionClient;

// The buyer columns we snapshot — the union of what transfer changes (ownership /
// pool) and what edit-field can change (the whitelisted fields). Capturing the
// whole set is cheap and lets one snapshot serve both op types.
export const BUYER_SNAPSHOT_SELECT = {
  id: true,
  ownerId: true, assignedAt: true, poolStatus: true, attemptCount: true,
  rejectedAt: true, rejectedById: true, rejectionReason: true, rejectCategory: true,
  nationality: true, projectName: true, tower: true, propertyType: true,
  configuration: true, agentName: true, transactionValue: true, remarks: true,
  businessStatus: true,
} satisfies Prisma.BuyerRecordSelect;

/** Snapshot the current state of the given buyer ids (call BEFORE the mutation). */
export function snapshotBuyers(db: DB, ids: string[]) {
  return db.buyerRecord.findMany({ where: { id: { in: ids } }, select: BUYER_SNAPSHOT_SELECT });
}

/** Record an executed operation with its before-state (the revert source). */
export async function logOperation(
  db: DB,
  opts: {
    operation: OperationType;
    entityType: "BuyerRecord" | "Lead";
    module: string;
    field?: string | null;
    summary?: string | null;
    affectedIds: string[];
    beforeState: unknown;
    afterState?: unknown;
    createdById: string;
  },
) {
  return db.operationLog.create({
    data: {
      operation: opts.operation,
      entityType: opts.entityType,
      module: opts.module,
      field: opts.field ?? null,
      summary: opts.summary ?? null,
      status: "EXECUTED",
      affectedCount: opts.affectedIds.length,
      affectedIds: opts.affectedIds as unknown as Prisma.InputJsonValue,
      beforeState: opts.beforeState as Prisma.InputJsonValue,
      ...(opts.afterState !== undefined ? { afterState: opts.afterState as Prisma.InputJsonValue } : {}),
      createdById: opts.createdById,
    },
  });
}

type BuyerSnap = Record<string, unknown> & { id: string };

// Build the exact update payload that RESTORES a buyer to its pre-op state — only
// the fields the op touched, so a later unrelated edit isn't reverted too.
function buyerRestoreData(op: { operation: string; field: string | null }, snap: BuyerSnap): Prisma.BuyerRecordUpdateInput {
  const asDate = (v: unknown) => (v ? new Date(String(v)) : null);
  if (op.operation === "buyer.edit" && op.field) {
    // Restore just the one edited field to its captured value.
    return { [op.field]: snap[op.field] ?? null } as Prisma.BuyerRecordUpdateInput;
  }
  // transfer / convert — restore ownership + pool provenance.
  return {
    owner: snap.ownerId ? { connect: { id: String(snap.ownerId) } } : { disconnect: true },
    assignedAt: asDate(snap.assignedAt),
    poolStatus: String(snap.poolStatus ?? BUYER_POOL_STATUS.ADMIN_POOL),
    attemptCount: Number(snap.attemptCount ?? 0),
    rejectedAt: asDate(snap.rejectedAt),
    rejectedById: (snap.rejectedById as string | null) ?? null,
    rejectionReason: (snap.rejectionReason as string | null) ?? null,
    rejectCategory: (snap.rejectCategory as string | null) ?? null,
  };
}

/**
 * Revert an operation, restoring every affected record to its captured before-state.
 * Idempotent-guarded (only an EXECUTED op can be reverted). Returns the count.
 */
export async function revertOperation(
  opId: string,
  meId: string,
): Promise<{ ok: boolean; restored: number; error?: string }> {
  const op = await prisma.operationLog.findUnique({ where: { id: opId } });
  if (!op) return { ok: false, restored: 0, error: "Operation not found." };
  if (op.status !== "EXECUTED") return { ok: false, restored: 0, error: `This operation is ${op.status.toLowerCase()} — nothing to revert.` };
  const before = (op.beforeState as unknown as BuyerSnap[] | null) ?? [];
  if (before.length === 0) return { ok: false, restored: 0, error: "No captured state to restore." };

  let restored = 0;
  if (op.entityType === "BuyerRecord") {
    await prisma.$transaction(async (tx) => {
      for (const snap of before) {
        const id = String(snap.id);
        const live = await tx.buyerRecord.findUnique({ where: { id }, select: { id: true } });
        if (!live) continue; // record gone (e.g. hard-purged) — skip, don't fail the batch
        await tx.buyerRecord.update({ where: { id }, data: buyerRestoreData(op, snap) });
        // Stint reconciliation for ownership reverts: close any stint the op opened,
        // then re-open one for the restored owner (or leave unassigned if null).
        if (op.operation === "buyer.transfer" || op.operation === "buyer.convert") {
          await tx.buyerAssignment.updateMany({ where: { buyerId: id, returnedAt: null }, data: { returnedAt: new Date(), returnReason: "ADMIN_REVERT" } });
          if (snap.ownerId) {
            await tx.buyerAssignment.create({ data: { buyerId: id, userId: String(snap.ownerId), assignedById: meId, assignedAt: snap.assignedAt ? new Date(String(snap.assignedAt)) : new Date() } });
          }
        }
        restored++;
      }
      await tx.operationLog.update({ where: { id: opId }, data: { status: "UNDONE", undoneAt: new Date(), undoneById: meId } });
    });
  } else {
    // Lead reverts land in a later increment — guard so we never half-apply.
    return { ok: false, restored: 0, error: "Lead operation revert is not enabled yet." };
  }
  return { ok: true, restored };
}

import "server-only";
import { Prisma, LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";

// ─────────────────────────────────────────────────────────────────────────────
// OPERATION LOG — reversible structural operations (Lalit 2026-07-08/09).
//
// One shared helper for every structural admin action (transfer / edit-field /
// convert / assignment, single + bulk, buyer + lead). On execute it snapshots the
// EXACT pre-op state of the affected rows; revertOperation() replays that snapshot
// so an accidental action can be undone atomically without DB surgery.
//
// Revert restores ONLY the fields the op changed (so a later, unrelated edit by
// someone else is never clobbered), reconciles buyer assignment stints, and — for a
// convert — soft-deletes the lead the convert created + clears the buyer's convert
// pointers. Conversation history / remarks / call logs are NEVER touched.
// ─────────────────────────────────────────────────────────────────────────────

export type OperationType =
  | "buyer.transfer"
  | "buyer.edit"
  | "buyer.convert"
  | "lead.transfer"
  | "lead.edit"
  // Master-Data assign (Lalit 2026-07-10): reactivates a Lost/Rejected record into a
  // working lead under a fresh owner + status + follow-up. Reversible — see the
  // dedicated leadRestoreData() branch below (restores the full rejection stamp).
  | "lead.assign";

type DB = typeof prisma | Prisma.TransactionClient;

// ── BUYER snapshot — the union of what transfer changes (ownership / pool),
//    what edit-field can change (whitelisted fields), and the convert pointers. ──
export const BUYER_SNAPSHOT_SELECT = {
  id: true,
  ownerId: true, assignedAt: true, poolStatus: true, attemptCount: true,
  rejectedAt: true, rejectedById: true, rejectionReason: true, rejectCategory: true,
  convertedLeadId: true, convertedAt: true, convertedById: true,
  nationality: true, projectName: true, tower: true, propertyType: true,
  configuration: true, agentName: true, transactionValue: true, remarks: true,
  businessStatus: true,
} satisfies Prisma.BuyerRecordSelect;

// ── LEAD snapshot — what transfer/assign changes (ownership + routing + SLA) plus
//    the fields a lead bulk-edit could touch (status / follow-up / tags / team). ──
export const LEAD_SNAPSHOT_SELECT = {
  id: true, ownerId: true, previousOwnerId: true, assignedAt: true,
  forwardedTeam: true, market: true, currentStatus: true, followupDate: true,
  tags: true, slaFirstCallBy: true, slaEscalated: true, routingMethod: true,
  // Master-Data assign (lead.assign) revert needs the FULL pre-reactivation stamp so an
  // undo can put the record back to Lost/Rejected exactly as it was. Additive: the
  // existing transfer/edit reverts never read these keys, so their behaviour is unchanged.
  previousStatus: true, rejectedAt: true, rejectionReason: true,
  rejectionNote: true, rejectedById: true, status: true,
} satisfies Prisma.LeadSelect;

/** Snapshot the current state of the given buyer ids (call BEFORE the mutation). */
export function snapshotBuyers(db: DB, ids: string[]) {
  return db.buyerRecord.findMany({ where: { id: { in: ids } }, select: BUYER_SNAPSHOT_SELECT });
}
/** Snapshot the current state of the given lead ids (call BEFORE the mutation). */
export function snapshotLeads(db: DB, ids: string[]) {
  return db.lead.findMany({ where: { id: { in: ids } }, select: LEAD_SNAPSHOT_SELECT });
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

type Snap = Record<string, unknown> & { id: string };
const asDate = (v: unknown) => (v ? new Date(String(v)) : null);

// Build the BUYER update that RESTORES the pre-op state — only the fields the op
// touched, so a later unrelated edit isn't reverted too.
function buyerRestoreData(op: { operation: string; field: string | null }, snap: Snap): Prisma.BuyerRecordUpdateInput {
  if (op.operation === "buyer.edit" && op.field) {
    return { [op.field]: snap[op.field] ?? null } as Prisma.BuyerRecordUpdateInput;
  }
  // transfer / convert — restore ownership + pool provenance (+ clear convert pointers).
  return {
    owner: snap.ownerId ? { connect: { id: String(snap.ownerId) } } : { disconnect: true },
    assignedAt: asDate(snap.assignedAt),
    poolStatus: String(snap.poolStatus ?? BUYER_POOL_STATUS.ADMIN_POOL),
    attemptCount: Number(snap.attemptCount ?? 0),
    rejectedAt: asDate(snap.rejectedAt),
    rejectedById: (snap.rejectedById as string | null) ?? null,
    rejectionReason: (snap.rejectionReason as string | null) ?? null,
    rejectCategory: (snap.rejectCategory as string | null) ?? null,
    convertedLead: snap.convertedLeadId ? { connect: { id: String(snap.convertedLeadId) } } : { disconnect: true },
    convertedAt: asDate(snap.convertedAt),
    convertedById: (snap.convertedById as string | null) ?? null,
  };
}

// Build the LEAD update that RESTORES the pre-op state.
function leadRestoreData(op: { operation: string; field: string | null }, snap: Snap): Prisma.LeadUpdateInput {
  if (op.operation === "lead.edit" && op.field) {
    if (op.field === "followupDate") return { followupDate: asDate(snap.followupDate) };
    if (op.field === "owner" || op.field === "ownerId") {
      return snap.ownerId ? { owner: { connect: { id: String(snap.ownerId) } } } : { owner: { disconnect: true } };
    }
    return { [op.field]: snap[op.field] ?? null } as Prisma.LeadUpdateInput;
  }
  // Master-Data assign (lead.assign) — undo the reactivation: return the record to its
  // captured pre-assign state (unassigned Lost/Rejected in Master Data, no follow-up).
  // Restore ownership + SLA (what assignLeadTo set), the status pair, the follow-up, and
  // the full rejection stamp + the vestigial `status` enum. Each genuinely-new key is
  // guarded by presence in the snapshot (`key in snap`) so a row captured before that
  // column existed leaves the column ALONE rather than nulling it (back-compat).
  if (op.operation === "lead.assign") {
    const d: Prisma.LeadUpdateInput = {
      owner: snap.ownerId ? { connect: { id: String(snap.ownerId) } } : { disconnect: true },
      previousOwnerId: (snap.previousOwnerId as string | null) ?? null,
      assignedAt: asDate(snap.assignedAt),
      currentStatus: (snap.currentStatus as string | null) ?? null,
      followupDate: asDate(snap.followupDate),
      slaFirstCallBy: asDate(snap.slaFirstCallBy),
      slaEscalated: Boolean(snap.slaEscalated),
    };
    if ("previousStatus" in snap) d.previousStatus = (snap.previousStatus as string | null) ?? null;
    if ("rejectedAt" in snap) d.rejectedAt = asDate(snap.rejectedAt);
    if ("rejectionReason" in snap) d.rejectionReason = (snap.rejectionReason as string | null) ?? null;
    if ("rejectionNote" in snap) d.rejectionNote = (snap.rejectionNote as string | null) ?? null;
    if ("rejectedById" in snap) d.rejectedById = (snap.rejectedById as string | null) ?? null;
    if ("status" in snap && snap.status) d.status = snap.status as LeadStatus;
    return d;
  }
  // transfer — restore ownership + routing + SLA.
  return {
    owner: snap.ownerId ? { connect: { id: String(snap.ownerId) } } : { disconnect: true },
    previousOwnerId: (snap.previousOwnerId as string | null) ?? null,
    assignedAt: asDate(snap.assignedAt),
    forwardedTeam: (snap.forwardedTeam as string | null) ?? null,
    market: (snap.market as string | null) ?? null,
    slaFirstCallBy: asDate(snap.slaFirstCallBy),
    slaEscalated: Boolean(snap.slaEscalated),
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
  const before = (op.beforeState as unknown as Snap[] | null) ?? [];
  if (before.length === 0) return { ok: false, restored: 0, error: "No captured state to restore." };

  let restored = 0;

  if (op.entityType === "BuyerRecord") {
    await prisma.$transaction(async (tx) => {
      for (const snap of before) {
        const id = String(snap.id);
        const live = await tx.buyerRecord.findUnique({ where: { id }, select: { id: true } });
        if (!live) continue; // record gone (e.g. hard-purged) — skip, don't fail the batch
        await tx.buyerRecord.update({ where: { id }, data: buyerRestoreData(op, snap) });
        // Ownership reverts: close the stint the op opened, re-open the restored owner's.
        if (op.operation === "buyer.transfer" || op.operation === "buyer.convert") {
          await tx.buyerAssignment.updateMany({ where: { buyerId: id, returnedAt: null }, data: { returnedAt: new Date(), returnReason: "ADMIN_REVERT" } });
          if (snap.ownerId) {
            await tx.buyerAssignment.create({ data: { buyerId: id, userId: String(snap.ownerId), assignedById: meId, assignedAt: snap.assignedAt ? new Date(String(snap.assignedAt)) : new Date() } });
          }
        }
        restored++;
      }
      // Convert revert: undo the lead the convert created. The convert relinked the
      // buyer's CallLogs onto that lead — un-relink them (leave the calls buyer-only, so
      // call history stays intact on the restored buyer) — then soft-delete the lead.
      // The copied Activity rows ride along on the soft-deleted (hidden) lead.
      if (op.operation === "buyer.convert") {
        const after = (op.afterState as { leadId?: string } | null) ?? {};
        if (after.leadId) {
          await tx.callLog.updateMany({ where: { leadId: after.leadId, buyerId: { not: null } }, data: { leadId: null } });
          await tx.lead.updateMany({ where: { id: after.leadId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: meId } });
        }
      }
      await tx.operationLog.update({ where: { id: opId }, data: { status: "UNDONE", undoneAt: new Date(), undoneById: meId } });
    });
  } else {
    // Lead — transfer / assign / edit reverts.
    await prisma.$transaction(async (tx) => {
      for (const snap of before) {
        const id = String(snap.id);
        const live = await tx.lead.findUnique({ where: { id }, select: { id: true } });
        if (!live) continue;
        await tx.lead.update({ where: { id }, data: leadRestoreData(op, snap) });
        restored++;
      }
      await tx.operationLog.update({ where: { id: opId }, data: { status: "UNDONE", undoneAt: new Date(), undoneById: meId } });
    });
  }
  return { ok: true, restored };
}

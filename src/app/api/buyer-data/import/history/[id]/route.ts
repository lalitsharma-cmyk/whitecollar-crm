import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/buyer-data/import/history/[id]
 *
 * ADMIN-ONLY (purge = SUPER ADMIN). Soft-delete ("revert") or restore an entire
 * Buyer Data import batch. Mirrors the Leads import-history route
 * (src/app/api/intake/history/[id]/route.ts).
 * body: { action: "delete" | "restore" | "purge", reason?: string }
 *
 * Delete  → marks the batch DELETED and SOFT-deletes every BuyerRecord it created
 *           (BuyerRecord.deletedAt set). Because every buyer list / pool / report /
 *           dedup read filters `deletedAt: null`, those buyers vanish from the whole
 *           CRM, returning it to its pre-import state. Nothing is hard-deleted, so it
 *           is fully reversible.
 * Restore → un-deletes the batch and the buyers it had soft-deleted.
 * Purge   → SUPER ADMIN only. Permanently hard-deletes the still-trashed buyers this
 *           batch created and the batch row itself. Only allowed once the batch is in
 *           Trash (DELETED) — i.e. delete → verify gone from views → purge.
 *
 * Every action writes an AuditLog entry ("buyer.import.<action>").
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  // ADMIN-only — agents and managers must never see or trigger this.
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Admins only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as { action?: unknown; reason?: unknown }));
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const batch = await prisma.buyerImportBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const now = new Date();

  if (action === "delete") {
    if (batch.status === "DELETED") {
      return NextResponse.json({ error: "This import has already been deleted." }, { status: 400 });
    }
    // Soft-delete every live BuyerRecord this batch created. Because every buyer
    // read filters deletedAt:null, the whole batch disappears from every list,
    // pool, rollup and dedup check — returning the CRM to its pre-import state.
    const res = await prisma.buyerRecord.updateMany({
      where: { importBatchId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: me.id },
    });
    await prisma.buyerImportBatch.update({
      where: { id },
      data: { status: "DELETED", deletedAt: now, deletedById: me.id, deleteReason: reason || null },
    });
    await audit({
      userId: me.id,
      action: "buyer.import.delete",
      entity: "BuyerImportBatch",
      entityId: id,
      meta: { count: res.count, source: batch.source, sourceRef: batch.sourceRef, reason: reason || null },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, count: res.count });
  }

  if (action === "restore") {
    if (batch.status !== "DELETED") {
      return NextResponse.json({ error: "This import is not deleted." }, { status: 400 });
    }
    // Un-delete the buyers this batch had soft-deleted and flip the batch back to
    // ACTIVE. BuyerRecord has no active-only unique index (unlike Lead.fingerprint),
    // so there is no collision guard to run — a straight restore is safe.
    const res = await prisma.buyerRecord.updateMany({
      where: { importBatchId: id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null },
    });
    await prisma.buyerImportBatch.update({
      where: { id },
      data: { status: "ACTIVE", deletedAt: null, deletedById: null, deleteReason: null },
    });
    await audit({
      userId: me.id,
      action: "buyer.import.restore",
      entity: "BuyerImportBatch",
      entityId: id,
      meta: { count: res.count, source: batch.source, sourceRef: batch.sourceRef, reason: reason || null },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, count: res.count });
  }

  if (action === "purge") {
    // Permanent, physical deletion — SUPER ADMIN ONLY. Removes the still-trashed
    // buyers this batch created and the batch row itself. This is the ONLY
    // destructive path in the buyer-import flow; everything else is reversible.
    // The rows are already soft-deleted (recoverable) until this runs — the
    // intended flow is delete → verify gone from views → purge, so no extra
    // in-code backup is needed here.
    if (!me.isSuperAdmin) {
      return NextResponse.json({ error: "Only a Super Admin can permanently purge." }, { status: 403 });
    }
    if (batch.status !== "DELETED") {
      return NextResponse.json({ error: "Move the import to Trash before purging it." }, { status: 400 });
    }
    const purged = await prisma.buyerRecord.deleteMany({ where: { importBatchId: id, deletedAt: { not: null } } });
    await prisma.buyerImportBatch.delete({ where: { id } });
    await audit({
      userId: me.id,
      action: "buyer.import.purge",
      entity: "BuyerImportBatch",
      entityId: id,
      meta: { count: purged.count, source: batch.source, sourceRef: batch.sourceRef, reason: reason || null },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, count: purged.count, purged: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

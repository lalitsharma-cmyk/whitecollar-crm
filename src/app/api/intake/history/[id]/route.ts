import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/intake/history/[id]
 *
 * ADMIN-ONLY. Soft-delete ("rollback") or restore an entire import batch.
 * body: { action: "delete" | "restore", reason?: string }
 *
 * Delete  → marks the batch DELETED and SOFT-deletes every NEW lead it created
 *           (Lead.deletedAt set). Those leads — and all their activities, call
 *           logs, notes, reminders and imported conversation history — disappear
 *           from every list/count (hidden via leadScopeWhere), returning the CRM
 *           to its pre-import state. Nothing is hard-deleted, so it is fully
 *           reversible. Leads the import only UPDATED (deduped) are NOT touched.
 * Restore → un-deletes the batch and the leads it had soft-deleted.
 *
 * Every action writes an AuditLog entry ("import.rollback" / "import.restore").
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

  const batch = await prisma.importBatch.findUnique({ where: { id } });
  if (!batch) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });

  const now = new Date();

  if (action === "delete") {
    if (batch.status === "DELETED") {
      return NextResponse.json({ error: "This import has already been deleted." }, { status: 400 });
    }
    // Soft-delete every NEW lead this batch created that is still live. Child
    // records (activities / call logs / notes / reminders) ride along because
    // the parent lead is now hidden everywhere.
    const res = await prisma.lead.updateMany({
      where: { importBatchId: id, deletedAt: null },
      data: { deletedAt: now, deletedById: me.id },
    });
    await prisma.importBatch.update({
      where: { id },
      data: { status: "DELETED", deletedAt: now, deletedById: me.id, deleteReason: reason || null },
    });
    await audit({
      userId: me.id,
      action: "import.rollback",
      entity: "ImportBatch",
      entityId: id,
      meta: {
        fileName: batch.fileName,
        leadsDeleted: res.count,
        updatedCount: batch.updatedCount,
        reason: reason || null,
      },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, leadsDeleted: res.count });
  }

  if (action === "restore") {
    if (batch.status !== "DELETED") {
      return NextResponse.json({ error: "This import is not deleted." }, { status: 400 });
    }
    // Restore exactly the leads this batch had soft-deleted. Lead.deletedAt is
    // only ever set by this rollback feature, so this is a precise inverse.
    const res = await prisma.lead.updateMany({
      where: { importBatchId: id, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null },
    });
    await prisma.importBatch.update({
      where: { id },
      data: { status: "ACTIVE", deletedAt: null, deletedById: null, deleteReason: null },
    });
    await audit({
      userId: me.id,
      action: "import.restore",
      entity: "ImportBatch",
      entityId: id,
      meta: { fileName: batch.fileName, leadsRestored: res.count },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, leadsRestored: res.count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

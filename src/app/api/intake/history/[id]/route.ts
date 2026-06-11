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
    // Restore the leads this batch had soft-deleted. Fingerprint is unique among
    // ACTIVE leads only, so if the same contact was re-imported AFTER this batch
    // was rolled back, restoring the old copy would collide with the live one.
    // Restore only the leads whose fingerprint is still free; skip + report the
    // rest instead of throwing a raw unique-constraint error.
    const toRestore = await prisma.lead.findMany({
      where: { importBatchId: id, deletedAt: { not: null } },
      select: { id: true, fingerprint: true },
    });
    const wantedFps = toRestore.map(l => l.fingerprint).filter((x): x is string => !!x);
    const takenFps = new Set(
      (wantedFps.length
        ? await prisma.lead.findMany({
            where: { deletedAt: null, fingerprint: { in: wantedFps } },
            select: { fingerprint: true },
          })
        : []
      ).map(l => l.fingerprint!),
    );
    const restorableIds = toRestore
      .filter(l => !l.fingerprint || !takenFps.has(l.fingerprint))
      .map(l => l.id);
    const blocked = toRestore.length - restorableIds.length;
    const res = await prisma.lead.updateMany({
      where: { id: { in: restorableIds } },
      data: { deletedAt: null, deletedById: null },
    });
    // Only flip the batch back to ACTIVE when everything was restored. If some
    // leads were blocked by an active duplicate, leave the batch flagged so the
    // admin knows there's a conflict to resolve (merge).
    await prisma.importBatch.update({
      where: { id },
      data: blocked === 0
        ? { status: "ACTIVE", deletedAt: null, deletedById: null, deleteReason: null }
        : { deleteReason: `Partially restored — ${blocked} lead(s) skipped because an active duplicate already exists.` },
    });
    await audit({
      userId: me.id,
      action: "import.restore",
      entity: "ImportBatch",
      entityId: id,
      meta: { fileName: batch.fileName, leadsRestored: res.count, blocked },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({
      ok: true,
      leadsRestored: res.count,
      blocked,
      ...(blocked ? { warning: `${blocked} lead(s) were not restored because an active lead with the same phone/email already exists.` } : {}),
    });
  }

  if (action === "purge") {
    // Permanent, physical deletion — SUPER ADMIN ONLY. Removes the still-trashed
    // leads this batch created (cascade-deletes their activities / calls / notes /
    // reminders) and the batch row itself. This is the ONLY destructive path in
    // the whole import flow; everything else is reversible.
    if (!me.isSuperAdmin) {
      return NextResponse.json({ error: "Only a Super Admin can permanently purge." }, { status: 403 });
    }
    if (batch.status !== "DELETED") {
      return NextResponse.json({ error: "Move the import to Trash before purging it." }, { status: 400 });
    }
    const purged = await prisma.lead.deleteMany({ where: { importBatchId: id, deletedAt: { not: null } } });
    await prisma.importBatch.delete({ where: { id } });
    await audit({
      userId: me.id,
      action: "import.purge",
      entity: "ImportBatch",
      entityId: id,
      meta: { fileName: batch.fileName, leadsPurged: purged.count },
      request: reqMeta(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, leadsPurged: purged.count, purged: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

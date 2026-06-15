import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

// =====================================================================
// MASTER DATA — bulk actions (ADMIN only). Master Data is the complete
// repository, so these operate on the given lead ids directly (no owner
// scoping). Every move/assign/status writes LeadFieldHistory; everything here
// is REVERSIBLE — moves flip back, delete is soft (→ Archived), restore undoes.
//
//   move_to_leads    leadOrigin → ACTIVE  (appears in Leads/Dashboard/KPIs)
//   move_to_revival  leadOrigin → COLD    (appears only in Revival Engine)
//   assign           set owner (+ assignedAt)
//   set_status       set currentStatus
//   soft_delete      Super-Admin only — deletedAt set (recoverable)
//   restore          clear deletedAt
// =====================================================================

type HistRow = { leadId: string; field: string; oldValue: string | null; newValue: string | null; changedById: string; source: string };

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Master Data actions are admin only." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No records selected" }, { status: 400 });

  const writeHistory = (rows: HistRow[]) => {
    if (rows.length) prisma.leadFieldHistory.createMany({ data: rows }).catch(() => {});
  };

  // ── Move between sections (leadOrigin flip) ──────────────────────────
  if (action === "move_to_leads" || action === "move_to_revival") {
    const target = action === "move_to_leads" ? "ACTIVE" : "COLD";
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, leadOrigin: true } });
    const changed = before.filter((b) => b.leadOrigin !== target);
    if (changed.length) {
      await prisma.lead.updateMany({
        where: { id: { in: changed.map((c) => c.id) } },
        data: { leadOrigin: target, isColdCall: target === "COLD" },
      });
      writeHistory(changed.map((c) => ({ leadId: c.id, field: "leadOrigin", oldValue: c.leadOrigin, newValue: target, changedById: me.id, source: "master-data-bulk" })));
    }
    await audit({ userId: me.id, action: "masterdata.bulk.move", entity: "Lead", meta: { target, moved: changed.length, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, moved: changed.length });
  }

  // ── Assign owner ─────────────────────────────────────────────────────
  if (action === "assign") {
    const userId = String(body.userId ?? "").trim();
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    const target = await prisma.user.findFirst({ where: { id: userId, active: true }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, ownerId: true } });
    const changed = before.filter((b) => b.ownerId !== userId);
    if (changed.length) {
      await prisma.lead.updateMany({ where: { id: { in: changed.map((c) => c.id) } }, data: { ownerId: userId, assignedAt: new Date() } });
      writeHistory(changed.map((c) => ({ leadId: c.id, field: "ownerId", oldValue: c.ownerId, newValue: userId, changedById: me.id, source: "master-data-bulk" })));
    }
    await audit({ userId: me.id, action: "masterdata.bulk.assign", entity: "Lead", meta: { userId, assigned: changed.length, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, assigned: changed.length });
  }

  // ── Set status ───────────────────────────────────────────────────────
  if (action === "set_status") {
    const status = String(body.status ?? "").trim();
    if (!status) return NextResponse.json({ error: "status required" }, { status: 400 });
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, currentStatus: true } });
    const changed = before.filter((b) => b.currentStatus !== status);
    if (changed.length) {
      await prisma.lead.updateMany({ where: { id: { in: changed.map((c) => c.id) } }, data: { currentStatus: status, lastTouchedAt: new Date() } });
      writeHistory(changed.map((c) => ({ leadId: c.id, field: "currentStatus", oldValue: c.currentStatus, newValue: status, changedById: me.id, source: "master-data-bulk" })));
    }
    await audit({ userId: me.id, action: "masterdata.bulk.status", entity: "Lead", meta: { status, updated: changed.length, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: changed.length });
  }

  // ── Soft delete (recoverable) — Super Admin only ─────────────────────
  if (action === "soft_delete") {
    if (!me.isSuperAdmin) return NextResponse.json({ error: "Only the Super Admin can delete records." }, { status: 403 });
    const rows = await prisma.lead.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    const r = await prisma.lead.updateMany({ where: { id: { in: rows.map((x) => x.id) } }, data: { deletedAt: new Date(), deletedById: me.id } });
    await audit({ userId: me.id, action: "masterdata.bulk.delete", entity: "Lead", meta: { soft: true, count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, deleted: r.count });
  }

  // ── Restore (undo soft delete) ───────────────────────────────────────
  if (action === "restore") {
    const r = await prisma.lead.updateMany({ where: { id: { in: ids }, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    await audit({ userId: me.id, action: "masterdata.bulk.restore", entity: "Lead", meta: { count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, restored: r.count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

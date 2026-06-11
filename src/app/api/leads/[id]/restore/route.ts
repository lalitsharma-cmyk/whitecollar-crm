import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/leads/[id]/restore
 *
 * SUPER-ADMIN (Lalit) ONLY. Brings a soft-deleted lead back into the active CRM
 * (clears deletedAt/deletedById). Logged to the audit trail.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  if (!me.isSuperAdmin) {
    return NextResponse.json({ error: "Only the Super Admin can restore leads." }, { status: 403 });
  }
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, name: true, deletedAt: true, fingerprint: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!lead.deletedAt) return NextResponse.json({ error: "Lead is not deleted." }, { status: 400 });

  // Fingerprint is unique among ACTIVE leads only. If the same contact was
  // re-created (e.g. re-imported) after this lead was deleted, restoring would
  // collide with the live copy. Fail with a clear message instead of a raw
  // unique-constraint 500, and point the admin at the active lead to merge into.
  if (lead.fingerprint) {
    const clash = await prisma.lead.findFirst({
      where: { fingerprint: lead.fingerprint, deletedAt: null },
      select: { id: true, name: true },
    });
    if (clash) {
      return NextResponse.json({
        error: `Can't restore — an active lead with the same phone/email already exists (${clash.name}). Merge into that lead instead.`,
        conflictLeadId: clash.id,
      }, { status: 409 });
    }
  }

  await prisma.lead.update({ where: { id }, data: { deletedAt: null, deletedById: null } });

  await audit({
    userId: me.id,
    action: "lead.restore",
    entity: "Lead",
    entityId: id,
    meta: { leadName: lead.name, leadId: lead.id, restoredBy: me.name },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

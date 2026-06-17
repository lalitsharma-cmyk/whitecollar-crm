import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * POST /api/leads/[id]/delete
 *
 * SUPER-ADMIN (Lalit) ONLY. Removes a lead from the active CRM — distinct from
 * Reject (which is a business outcome). This is a SOFT delete: the lead is
 * hidden everywhere via leadScopeWhere (deletedAt set) but NEVER destroyed. A
 * full snapshot is written to the audit log (Super-Admin Archive) so accidental
 * deletes can be restored.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  if (!me.isSuperAdmin) {
    return NextResponse.json({ error: "Only the Super Admin can delete leads." }, { status: 403 });
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.deletedAt) return NextResponse.json({ error: "Lead is already deleted." }, { status: 400 });

  const now = new Date();
  await prisma.lead.update({ where: { id }, data: { deletedAt: now, deletedById: me.id } });

  // Priority-3 cleanup: a deleted lead must not exist ANYWHERE. Remove its
  // pending in-app/push notifications (assignment, follow-up, duplicate, SLA
  // alerts) so owners stop being pinged about a lead that's gone. Future
  // reminders never fire — every reminder cron + dup/history/search query
  // already filters deletedAt:null.
  await prisma.notification.deleteMany({ where: { leadId: id } }).catch(() => {});

  // Super-Admin Archive — full original snapshot + who/when, for restore + audit.
  await audit({
    userId: me.id,
    action: "lead.delete",
    entity: "Lead",
    entityId: id,
    meta: {
      leadName: lead.name,
      leadId: lead.id,
      deletedBy: me.name,
      deletedAt: now.toISOString(),
      snapshot: JSON.parse(JSON.stringify(lead)),
    },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

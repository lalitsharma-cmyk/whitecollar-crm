// POST /api/leads/[id]/escalation/[escId]/resolve — close an escalation thread.
// The raising agent OR any admin/manager can resolve. Notifies the other party.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; escId: string }> }) {
  const { id, escId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const esc = await prisma.leadEscalation.findFirst({
    where: { id: escId, leadId: id },
    select: { id: true, status: true, raisedById: true },
  });
  if (!esc) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
  if (esc.status === "RESOLVED") return NextResponse.json({ ok: true, already: true });

  const isManager = me.role === "ADMIN" || me.role === "MANAGER";
  if (!isManager && esc.raisedById !== me.id) {
    return NextResponse.json({ error: "Only the agent who raised it or a manager can resolve this." }, { status: 403 });
  }

  await prisma.leadEscalation.update({
    where: { id: esc.id },
    data: { status: "RESOLVED", resolvedById: me.id, resolvedAt: new Date() },
  });

  // Tell the other side it's closed. Manager resolves → notify raiser; raiser
  // resolves → notify the admins/managers.
  if (isManager && esc.raisedById && esc.raisedById !== me.id) {
    notify({
      userId: esc.raisedById, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `✅ Escalation resolved on ${lead.name}`,
      body: `${me.name ?? "Manager"} marked your escalation resolved.`, linkUrl: `/leads/${id}`, leadId: id,
    }).catch(() => {});
  } else if (!isManager) {
    const managers = await prisma.user.findMany({
      where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER"] }, id: { not: me.id } },
      select: { id: true },
    });
    for (const m of managers) {
      notify({
        userId: m.id, kind: NotifKind.SYSTEM, severity: "INFO",
        title: `✅ ${me.name ?? "Agent"} resolved their escalation on ${lead.name}`,
        body: "No further action needed.", linkUrl: `/leads/${id}`, leadId: id,
      }).catch(() => {});
    }
  }
  await audit({
    userId: me.id, action: "voice.escalation.resolve", entity: "Lead", entityId: id,
    meta: { escalationId: esc.id }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

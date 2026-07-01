// POST /api/buyer-data/[id]/escalation/[escId]/resolve — close a buyer escalation.
// The raising agent OR any admin/manager can resolve. Notifies the other party.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; escId: string }> }) {
  const me = await requireUser();
  const { id, escId } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id }, select: { id: true, clientName: true, ownerId: true, poolStatus: true, deletedAt: true, market: true } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const esc = await prisma.buyerEscalation.findFirst({
    where: { id: escId, buyerId: id },
    select: { id: true, status: true, raisedById: true },
  });
  if (!esc) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
  if (esc.status === "RESOLVED") return NextResponse.json({ ok: true, already: true });

  const isManager = me.role === "ADMIN" || me.role === "MANAGER";
  if (!isManager && esc.raisedById !== me.id) {
    return NextResponse.json({ error: "Only the agent who raised it or a manager can resolve this." }, { status: 403 });
  }

  await prisma.buyerEscalation.update({
    where: { id: esc.id },
    data: { status: "RESOLVED", resolvedById: me.id, resolvedAt: new Date() },
  });

  if (isManager && esc.raisedById && esc.raisedById !== me.id) {
    notify({
      userId: esc.raisedById, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `✅ Escalation resolved on buyer ${buyer.clientName}`,
      body: `${me.name ?? "Manager"} marked your escalation resolved.`, linkUrl: `/buyer-data/${id}`,
    }).catch(() => {});
  } else if (!isManager) {
    const managers = await prisma.user.findMany({
      where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER"] }, id: { not: me.id } },
      select: { id: true },
    });
    for (const m of managers) {
      notify({
        userId: m.id, kind: NotifKind.SYSTEM, severity: "INFO",
        title: `✅ ${me.name ?? "Agent"} resolved their escalation on buyer ${buyer.clientName}`,
        body: "No further action needed.", linkUrl: `/buyer-data/${id}`,
      }).catch(() => {});
    }
  }
  await audit({
    userId: me.id, action: "voice.escalation.resolve", entity: "BuyerRecord", entityId: id,
    meta: { escalationId: esc.id }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

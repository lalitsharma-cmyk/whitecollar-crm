import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { BUYER_POOL_STATUS, BUYER_ACTIVITY_TYPE } from "@/lib/buyerLifecycle";

/**
 * POST /api/buyer-data/[id]/action-escalate
 *
 * Buyer-side twin of /api/leads/[id]/action-escalate — powers the SAME
 * LeadFollowupActions "Escalate" button on the Buyer detail view. Kicks the buyer
 * up to the sales managers.
 *
 * BuyerRecord has no needsManagerReview/flaggedAt column (that's a Lead-only field),
 * so v1 escalation is additive-only: it writes an "ESCALATED" BuyerActivity to the
 * timeline AND notifies the sales managers (in-app + push) with a link to the buyer
 * — so an escalation reaches a human immediately, exactly like the lead flow. A
 * future increment can add a buyer manager-review queue if Lalit wants one.
 *
 * Body (optional): { reason?: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id }, include: { owner: { select: { name: true, managerId: true } } } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const isAdmin = me.role === "ADMIN";
  const canLog = isAdmin || (buyer.ownerId === me.id && buyer.poolStatus === BUYER_POOL_STATUS.ASSIGNED);
  if (!canLog) return NextResponse.json({ error: "You can only escalate an assigned buyer." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim() || "Agent escalated from the Buyer view";

  const now = new Date();
  await prisma.buyerActivity.create({
    data: {
      buyerId: id,
      userId: me.id,
      type: BUYER_ACTIVITY_TYPE.ESCALATED,
      description: `🆘 Escalated to manager — ${reason}`,
    },
  });

  // Notify the sales managers — role ADMIN/MANAGER, excluding leadOpsOnly (data
  // admins) + hrOnly, plus the owner's manager-of-record; never the escalator.
  try {
    const recipientIds = new Set<string>();
    const managers = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "MANAGER"] }, active: true, leadOpsOnly: false, hrOnly: false },
      select: { id: true },
    });
    for (const a of managers) recipientIds.add(a.id);
    if (buyer.owner?.managerId) recipientIds.add(buyer.owner.managerId);
    recipientIds.delete(me.id);

    const ownerLabel = buyer.owner?.name ?? "(unassigned)";
    for (const uid of recipientIds) {
      notify({
        userId: uid,
        kind: "REMINDER",
        severity: "WARNING",
        title: `🆘 ${me.name} escalated buyer ${buyer.clientName} for your review`,
        body: `Owner: ${ownerLabel} · Reason: ${reason}`,
        linkUrl: `/buyer-data/${id}`,
      }).catch(() => {});
    }
  } catch {
    // notification failure must never roll back a legitimate escalation
  }

  await audit({
    userId: me.id, action: "buyer.action-escalate", entity: "BuyerRecord", entityId: id,
    meta: { reason }, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, leadName: buyer.clientName, flaggedAt: now.toISOString(), reason });
}

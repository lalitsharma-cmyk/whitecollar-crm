import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { returnBuyerToPoolInTx, BUYER_POOL_STATUS, BUYER_RETURN_REASON } from "@/lib/buyerLifecycle";

// ── Return an ASSIGNED buyer to the Admin Pool (NOT a reject) ─────────────────
// A DISTINCT business action from Reject: the buyer stays ACTIVE and simply goes
// back to the unassigned Admin Pool for reassignment (still a live prospect — the
// agent just can't work it right now). No reject-audit fields are stamped. Assigned
// agent (own ASSIGNED) or admin. Body: { reason?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim() || null;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (buyer.poolStatus !== BUYER_POOL_STATUS.ASSIGNED) {
    return NextResponse.json({ error: "Only an assigned buyer can be returned to the pool." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await returnBuyerToPoolInTx(tx, id, BUYER_RETURN_REASON.RETURN_TO_POOL, me.id, reason);
  });

  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      notify({
        userId: a.id,
        kind: "BUYER_RETURNED",
        severity: "INFO",
        title: `↩️ Buyer returned to pool: ${buyer.clientName}`,
        body: `${me.name} returned this buyer to the Admin Buyer Pool${reason ? ` — ${reason}` : ""}. Still active — ready for reassignment.`,
        linkUrl: `/buyer-data/${id}`,
        source: { type: "ASSIGNMENT", id, createdById: me.id },
      }).catch(() => null),
    ),
  );

  await audit({
    userId: me.id,
    action: "buyer.return-to-pool",
    entity: "BuyerRecord",
    entityId: id,
    meta: { reason },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, returnedToPool: true });
}

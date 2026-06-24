import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { returnBuyerToPoolInTx, BUYER_POOL_STATUS, BUYER_RETURN_REASON } from "@/lib/buyerLifecycle";

// ── Reject / Return a buyer to the Admin Pool ────────────────────────────────
// Assigned AGENT (their own ASSIGNED buyer) — or admin. Returns the buyer to the
// Admin Pool: clears ownerId, poolStatus=ADMIN_POOL, stamps rejectedAt/ById/reason
// + returnedToPoolAt, closes the open BuyerAssignment stint (MANUAL_REJECT), and
// RETAINS all remarks + BuyerActivity history (the buyer goes back for reassignment,
// nothing is lost). Logs BuyerActivity REJECTED + RETURNED, notifies admins.
//
// Body: { reason?: string } — optional rejection reason (free text).
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
    await returnBuyerToPoolInTx(tx, id, BUYER_RETURN_REASON.MANUAL_REJECT, me.id, reason);
  });

  // Tell admins a buyer is back in the pool (best-effort). Use notifyRoles-style
  // single notify to each admin via the existing helper would be heavier; the
  // pool is admin-managed, so a lightweight SYSTEM notice to admins suffices.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      notify({
        userId: a.id,
        kind: "BUYER_RETURNED",
        severity: "INFO",
        title: `↩️ Buyer returned to pool: ${buyer.clientName}`,
        body: `${me.name} returned this buyer to the Admin Buyer Pool${reason ? ` — ${reason}` : ""}. Ready for reassignment.`,
        linkUrl: `/buyer-data/${id}`,
      }).catch(() => null),
    ),
  );

  await audit({
    userId: me.id,
    action: "buyer.reject",
    entity: "BuyerRecord",
    entityId: id,
    meta: { reason },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, returnedToPool: true });
}

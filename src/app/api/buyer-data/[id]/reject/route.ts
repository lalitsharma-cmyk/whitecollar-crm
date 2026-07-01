import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { rejectBuyerInTx, BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";

// ── TERMINAL Reject a buyer ──────────────────────────────────────────────────
// Assigned AGENT (their own ASSIGNED buyer) — or admin. Moves the buyer to the
// TERMINAL Rejected state: clears ownerId (removed from the agent queue + the
// active/working list), poolStatus=REJECTED, closes the open stint (MANUAL_REJECT),
// and stamps the FULL reject audit (reason + category + who + when + AI-revival
// eligibility). It is NOT returned to the Admin Pool — a rejected buyer stays in the
// Rejected tab until an admin REACTIVATES it (POST /reactivate). "Return to Pool" is
// a SEPARATE action (POST /return-to-pool). RETAINS all remarks + BuyerActivity
// history — nothing is ever deleted.
//
// Body: { reason?: string; category?: string; aiEligibleForRevival?: boolean }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim() || null;
  const category = String(body.category ?? "").trim() || null;
  const aiEligibleForRevival = typeof body.aiEligibleForRevival === "boolean" ? body.aiEligibleForRevival : null;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (buyer.poolStatus !== BUYER_POOL_STATUS.ASSIGNED) {
    return NextResponse.json({ error: "Only an assigned buyer can be rejected." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await rejectBuyerInTx(tx, id, me.id, { reason, category, aiEligibleForRevival });
  });

  // Notify admins that a buyer was rejected (terminal). Best-effort.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      notify({
        userId: a.id,
        kind: "BUYER_RETURNED",
        severity: "INFO",
        title: `🚫 Buyer rejected: ${buyer.clientName}`,
        body: `${me.name} rejected this buyer${category ? ` [${category}]` : ""}${reason ? ` — ${reason}` : ""}. It has left the active list (now in the Rejected tab).`,
        linkUrl: `/buyer-data/${id}`,
      }).catch(() => null),
    ),
  );

  await audit({
    userId: me.id,
    action: "buyer.reject",
    entity: "BuyerRecord",
    entityId: id,
    meta: { reason, category, aiEligibleForRevival, terminal: true },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, rejected: true });
}

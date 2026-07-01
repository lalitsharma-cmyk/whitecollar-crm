import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { reactivateBuyerInTx, BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";

// ── REACTIVATE a REJECTED buyer → back to the Admin Pool (ADMIN ONLY) ─────────
// The admin-approved entry point for the AI Reactivation Engine flow:
//   Rejected → AI recommendation → admin approval → REACTIVATE → assign.
// Clears the terminal reject markers, poolStatus=ADMIN_POOL, logs REACTIVATED. The
// reject audit is preserved in the timeline. Only a REJECTED buyer can be
// reactivated. Body: { note?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admins only." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const note = String(body.note ?? "").trim() || null;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (buyer.poolStatus !== BUYER_POOL_STATUS.REJECTED) {
    return NextResponse.json({ error: "Only a rejected buyer can be reactivated." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await reactivateBuyerInTx(tx, id, me.id, note);
  });

  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  await Promise.all(
    admins.map((a) =>
      notify({
        userId: a.id,
        kind: "BUYER_RETURNED",
        severity: "INFO",
        title: `♻️ Buyer reactivated: ${buyer.clientName}`,
        body: `${me.name} reactivated this rejected buyer to the Admin Pool${note ? ` — ${note}` : ""}. Ready to reassign.`,
        linkUrl: `/buyer-data/${id}`,
      }).catch(() => null),
    ),
  );

  await audit({
    userId: me.id,
    action: "buyer.reactivate",
    entity: "BuyerRecord",
    entityId: id,
    meta: { note, from: "REJECTED" },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, reactivated: true });
}

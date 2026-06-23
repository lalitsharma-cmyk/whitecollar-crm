import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import {
  logBuyerContactInTx,
  LOGGABLE_ACTIVITY_TYPES,
  ATTEMPT_TYPES,
  AUTO_RETURN_ATTEMPTS,
  BUYER_POOL_STATUS,
} from "@/lib/buyerLifecycle";

// ── Log a buyer contact activity / attempt ───────────────────────────────────
// Assigned AGENT (their own ASSIGNED buyer) — or admin. Logs a CALL / NOTE /
// WHATSAPP / VOICE_NOTE, or an ATTEMPT (No Answer / Not Picked / WA No Response).
// Attempts increment attemptCount + the open stint's attemptsInStint and write a
// BuyerActivity row. AUTO-RETURN: when attemptCount reaches 5, the buyer is
// automatically returned to the Admin Pool (returnReason=AUTO_5_ATTEMPTS), removed
// from the agent, with ALL history retained. Event-driven on the 5th attempt — no
// cron. Non-attempt activities (call/note/wa/voice) never trigger the return.
//
// Body: { type: string, description?: string }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const type = String(body.type ?? "").trim().toUpperCase();
  if (!LOGGABLE_ACTIVITY_TYPES.has(type)) {
    return NextResponse.json(
      { error: `Invalid activity type. One of: ${Array.from(LOGGABLE_ACTIVITY_TYPES).join(", ")}` },
      { status: 400 },
    );
  }
  const description = String(body.description ?? "").trim() || null;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (buyer.poolStatus !== BUYER_POOL_STATUS.ASSIGNED) {
    return NextResponse.json({ error: "You can only log activity on an assigned buyer." }, { status: 400 });
  }

  const outcome = await prisma.$transaction(async (tx) => {
    return logBuyerContactInTx(tx, id, me.id, type, description);
  });

  // On auto-return, alert admins the buyer is back in the pool (best-effort).
  if (outcome.autoReturned) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    await Promise.all(
      admins.map((a) =>
        notify({
          userId: a.id,
          kind: "SYSTEM",
          severity: "INFO",
          title: `🔁 Buyer auto-returned to pool: ${buyer.clientName}`,
          body: `${AUTO_RETURN_ATTEMPTS} contact attempts logged by ${me.name} with no success — returned to the Admin Buyer Pool for reassignment.`,
          linkUrl: `/buyer-data/${id}`,
        }).catch(() => null),
      ),
    );
  }

  await audit({
    userId: me.id,
    action: "buyer.activity",
    entity: "BuyerRecord",
    entityId: id,
    meta: { type, isAttempt: ATTEMPT_TYPES.has(type), attemptCount: outcome.attemptCount, autoReturned: outcome.autoReturned },
    request: reqMeta(req),
  });

  return NextResponse.json({
    ok: true,
    type,
    attemptCount: outcome.attemptCount,
    autoReturned: outcome.autoReturned,
    ...(outcome.autoReturned ? { returnedToPool: true } : {}),
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";
import { BUYER_POOL_STATUS, BUYER_ACTIVITY_TYPE } from "@/lib/buyerLifecycle";
import { hasBuyerContactToday } from "@/lib/buyerFollowup";
import { nextFollowupAfterCompletion } from "@/lib/followup";

/**
 * POST /api/buyer-data/[id]/action-complete
 *
 * Buyer-side twin of /api/leads/[id]/action-complete — powers the SAME
 * LeadFollowupActions "Complete" button on the Buyer detail view (apiBase
 * "/api/buyer-data"). Marks the current buyer follow-up done:
 *   • followupDate → rolled forward to (now + 1 day) via the SHARED
 *     nextFollowupAfterCompletion helper, so completing always leaves a next
 *     touchpoint (parity with leads — never drops the buyer off the follow-up board).
 *   • a BuyerActivity "COMPLETED" row is written so the timeline shows the complete.
 *
 * ── COMPLETION GATE (Lalit's policy, parity with leads) ───────────────────────
 * An AGENT may not complete without a logged contact TODAY (IST). Admins bypass.
 * Enforced server-side so a tampered request can't skip the disabled UI button.
 *
 * Additive only — no schema change (BuyerRecord.followupDate + BuyerActivity.type
 * are existing columns; "COMPLETED" is a plain-string type value).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Complete is a worked-buyer action — only on an ASSIGNED buyer (owner or admin).
  const isAdmin = me.role === "ADMIN";
  const canLog = isAdmin || (buyer.ownerId === me.id && buyer.poolStatus === BUYER_POOL_STATUS.ASSIGNED);
  if (!canLog) return NextResponse.json({ error: "You can only complete a follow-up on an assigned buyer." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const note = String(body.note ?? "").trim();

  // Gate: agents must have logged a contact attempt today. Admins/Managers bypass.
  if (me.role === "AGENT" && !(await hasBuyerContactToday(id))) {
    return NextResponse.json(
      { error: "You cannot complete this follow-up without logging a call, WhatsApp, or voice attempt first.", contactRequired: true },
      { status: 400 },
    );
  }

  const now = new Date();
  const rolled = nextFollowupAfterCompletion(now);

  await prisma.$transaction([
    prisma.buyerRecord.update({ where: { id }, data: { followupDate: rolled } }),
    prisma.buyerActivity.create({
      data: {
        buyerId: id,
        userId: me.id,
        type: BUYER_ACTIVITY_TYPE.COMPLETED,
        description: note || "Follow-up completed",
      },
    }),
  ]);

  await audit({
    userId: me.id, action: "buyer.action-complete", entity: "BuyerRecord", entityId: id,
    meta: { rolledFollowup: rolled.toISOString() }, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, leadName: buyer.clientName, followupDate: rolled.toISOString() });
}

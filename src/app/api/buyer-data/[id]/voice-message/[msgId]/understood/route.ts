// POST /api/buyer-data/[id]/voice-message/[msgId]/understood — mark a buyer voice
// message as listened/understood by the current user (clears their unread badge).
// Scoped via canTouchBuyer so only someone who can see the buyer can mark it.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTouchBuyer } from "@/lib/buyerScope";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const me = await requireUser();
  const { id, msgId } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id }, select: { ownerId: true, poolStatus: true, deletedAt: true, market: true } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const msg = await prisma.buyerVoiceMessage.findFirst({ where: { id: msgId, buyerId: id }, select: { id: true } });
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.buyerVoiceMessageRead.upsert({
    where: { voiceMessageId_userId: { voiceMessageId: msgId, userId: me.id } },
    create: { voiceMessageId: msgId, userId: me.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

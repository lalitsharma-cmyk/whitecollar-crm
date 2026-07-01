// GET /api/buyer-data/[id]/voice-message/[msgId]/audio — stream the original buyer
// voice-guidance audio INLINE. Scoped via canTouchBuyer (only users who can see the
// buyer). No download attribute — agents listen, they don't download/forward. The
// bytes are returned EXACTLY as stored. Mirrors the lead audio route.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTouchBuyer } from "@/lib/buyerScope";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const me = await requireUser();
  const { id, msgId } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id }, select: { ownerId: true, poolStatus: true, deletedAt: true, market: true } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const msg = await prisma.buyerVoiceMessage.findFirst({
    where: { id: msgId, buyerId: id },
    select: { audioData: true, mimeType: true },
  });
  if (!msg || !msg.audioData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = Buffer.isBuffer(msg.audioData) ? msg.audioData : Buffer.from(msg.audioData as unknown as ArrayBuffer);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": msg.mimeType || "audio/webm",
      "Content-Length": String(body.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "none",
    },
  });
}

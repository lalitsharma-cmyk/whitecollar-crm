// GET /api/leads/[id]/voice-message/[msgId]/audio — stream the original audio INLINE.
// Scoped via loadOwnedLead (only users who can see the lead). No download attribute —
// agents listen, they don't download/forward. The bytes are returned EXACTLY as stored.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const { id, msgId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const msg = await prisma.leadVoiceMessage.findFirst({
    where: { id: msgId, leadId: id },
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

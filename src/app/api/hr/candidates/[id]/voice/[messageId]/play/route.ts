// GET /api/hr/candidates/[id]/voice/[messageId]/play — stream the original audio INLINE.
// Scoped via loadOwnedCandidate (only users who can touch the candidate). No download
// attribute — HR users listen, they don't download/forward. Bytes returned EXACTLY as
// stored. Mirrors /api/leads/[id]/voice-message/[msgId]/audio.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedCandidate } from "@/lib/hrAccess";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;

  const msg = await prisma.hRVoiceMessage.findFirst({
    where: { id: messageId, candidateId: id },
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

// GET /api/voice-broadcast/[id]/audio — stream a broadcast's audio INLINE.
// Access: the sender, or any user the broadcast is targeted to (ALL / their TEAM /
// them). Bytes returned EXACTLY as stored; no download.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const bc = await prisma.voiceBroadcast.findUnique({
    where: { id },
    select: { audioData: true, mimeType: true, createdById: true, targetKind: true, targetTeam: true, targetUserId: true },
  });
  if (!bc || !bc.audioData) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isRecipient =
    bc.createdById === me.id ||
    bc.targetKind === "ALL" ||
    (bc.targetKind === "TEAM" && bc.targetTeam === me.team) ||
    (bc.targetKind === "USER" && bc.targetUserId === me.id);
  if (!isRecipient) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = Buffer.isBuffer(bc.audioData) ? bc.audioData : Buffer.from(bc.audioData as unknown as ArrayBuffer);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": bc.mimeType || "audio/webm",
      "Content-Length": String(body.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
      "Accept-Ranges": "none",
    },
  });
}

// POST /api/voice-broadcast/[id]/heard — mark a broadcast as listened by the
// current user (clears the "new" badge). Idempotent via the unique (broadcast,user).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  // Only mark heard if it exists (cheap guard); upsert is idempotent.
  const exists = await prisma.voiceBroadcast.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.voiceBroadcastRead.upsert({
    where: { broadcastId_userId: { broadcastId: id, userId: me.id } },
    create: { broadcastId: id, userId: me.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

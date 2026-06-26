// POST /api/leads/[id]/voice-message/[msgId]/understood — mark a voice message as
// listened/understood by the current user (clears their unread badge). Scoped via
// loadOwnedLead so only someone who can see the lead can mark it.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";

export const runtime = "nodejs";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; msgId: string }> }) {
  const { id, msgId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const msg = await prisma.leadVoiceMessage.findFirst({ where: { id: msgId, leadId: id }, select: { id: true } });
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.voiceMessageRead.upsert({
    where: { voiceMessageId_userId: { voiceMessageId: msgId, userId: me.id } },
    create: { voiceMessageId: msgId, userId: me.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

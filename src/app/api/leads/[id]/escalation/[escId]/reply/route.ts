// POST /api/leads/[id]/escalation/[escId]/reply — Channel ② manager reply.
// ADMIN/MANAGER only. Adds an ESCALATION_REPLY voice message to the thread, flips
// the thread to MANAGER_REPLIED, and notifies the agent who raised it.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export const runtime = "nodejs";
const MAX_AUDIO = 5 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; escId: string }> }) {
  const { id, escId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Only a manager can reply to an escalation." }, { status: 403 });
  }

  const esc = await prisma.leadEscalation.findFirst({
    where: { id: escId, leadId: id },
    select: { id: true, status: true, raisedById: true },
  });
  if (!esc) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
  if (esc.status === "RESOLVED") return NextResponse.json({ error: "This escalation is already resolved." }, { status: 409 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO) {
    return NextResponse.json({ error: "Recording too long (max ~5 MB / 5–8 min)." }, { status: 413 });
  }
  const transcript = (String(form.get("transcript") ?? "").trim()) || null;
  const textNote = (String(form.get("textNote") ?? "").trim()) || null;
  const lang = (String(form.get("lang") ?? "").trim()) || null;
  const durRaw = Number(form.get("durationSec"));
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
  const mimeType = (audio.type && audio.type.startsWith("audio/")) ? audio.type : "audio/webm";
  const buf = Buffer.from(await audio.arrayBuffer());

  const msg = await prisma.leadVoiceMessage.create({
    data: {
      leadId: id, kind: "ESCALATION_REPLY", createdById: me.id, escalationId: esc.id,
      audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, textNote,
    },
    select: { id: true },
  });
  await prisma.leadEscalation.update({ where: { id: esc.id }, data: { status: "MANAGER_REPLIED" } });

  if (esc.raisedById && esc.raisedById !== me.id) {
    const preview = transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open the lead to listen.";
    notify({
      userId: esc.raisedById, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `💬 ${me.name ?? "Manager"} replied to your escalation on ${lead.name}`,
      body: preview, linkUrl: `/leads/${id}`, leadId: id,
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.escalation.reply", entity: "Lead", entityId: id,
    meta: { escalationId: esc.id, msgId: msg.id, bytes: buf.length }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: msg.id });
}

// POST /api/leads/[id]/voice-message — record a Manager Voice Guidance note (Channel ①).
// Admin/Lalit only. Stores the ORIGINAL audio bytes (≤5MB bytea) verbatim + the
// browser transcript. Notifies the lead owner (agent) so they get the unread badge.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export const runtime = "nodejs";
const MAX_AUDIO = 5 * 1024 * 1024; // 5 MB ≈ 5–8 min Opus

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;
  // Channel ① Guidance: only an admin/super-admin records guidance on a lead.
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only an admin can record voice guidance." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO) {
    return NextResponse.json({ error: "Recording too long (max ~5 MB / 5–8 min). Please record a shorter clip." }, { status: 413 });
  }
  const transcript = (String(form.get("transcript") ?? "").trim()) || null;
  const title = (String(form.get("title") ?? "").trim()) || null;
  const lang = (String(form.get("lang") ?? "").trim()) || null;
  const durRaw = Number(form.get("durationSec"));
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
  const mimeType = (audio.type && audio.type.startsWith("audio/")) ? audio.type : "audio/webm";

  const buf = Buffer.from(await audio.arrayBuffer());

  const msg = await prisma.leadVoiceMessage.create({
    data: {
      leadId: id,
      kind: "GUIDANCE",
      createdById: me.id,
      audioData: buf,
      mimeType,
      durationSec,
      transcript,
      transcriptLang: lang,
      title,
    },
    select: { id: true },
  });

  // Unread badge for the assigned agent — ping the lead owner (not self).
  if (lead.ownerId && lead.ownerId !== me.id) {
    notify({
      userId: lead.ownerId,
      kind: NotifKind.SYSTEM,
      severity: "INFO",
      title: `🎤 Voice guidance from ${me.name ?? "Admin"} on ${lead.name}`,
      body: transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open the lead to listen.",
      linkUrl: `/leads/${id}`,
      leadId: id,
      source: { type: "VOICE", id: msg.id, createdById: me.id },
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.guidance.create", entity: "Lead", entityId: id,
    meta: { msgId: msg.id, bytes: buf.length, hasTranscript: !!transcript }, request: reqMeta(req),
  }).catch(() => {});
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});

  return NextResponse.json({ ok: true, id: msg.id });
}

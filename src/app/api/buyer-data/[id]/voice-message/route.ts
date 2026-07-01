// POST /api/buyer-data/[id]/voice-message — record a Manager Voice Guidance note on
// a buyer (Buyer-view parity with the Lead voice channel). Admin/Lalit only. Stores
// the ORIGINAL audio bytes (≤5MB bytea) verbatim + the browser transcript, and pings
// the assigned agent (owner) so they get the unread badge. Mirrors the lead route.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer } from "@/lib/buyerScope";

export const runtime = "nodejs";
const MAX_AUDIO = 5 * 1024 * 1024; // 5 MB ≈ 5–8 min Opus

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({ where: { id }, select: { id: true, clientName: true, ownerId: true, poolStatus: true, deletedAt: true, market: true } });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Channel ① Guidance: only an admin records guidance (parity with the lead route).
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

  const msg = await prisma.buyerVoiceMessage.create({
    data: {
      buyerId: id,
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

  // Unread badge for the assigned agent — ping the buyer owner (not self).
  if (buyer.ownerId && buyer.ownerId !== me.id) {
    notify({
      userId: buyer.ownerId,
      kind: NotifKind.SYSTEM,
      severity: "INFO",
      title: `🎤 Voice guidance from ${me.name ?? "Admin"} on ${buyer.clientName}`,
      body: transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open the buyer to listen.",
      linkUrl: `/buyer-data/${id}`,
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.guidance.create", entity: "BuyerRecord", entityId: id,
    meta: { msgId: msg.id, bytes: buf.length, hasTranscript: !!transcript }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: msg.id });
}

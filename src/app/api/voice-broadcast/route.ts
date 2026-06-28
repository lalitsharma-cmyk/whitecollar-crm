// POST /api/voice-broadcast — Feature 1: Dashboard Voice Broadcast.
// Lalit/Admin records a voice message and sends it to ALL / a TEAM / one USER.
// Recipients see + play it on their dashboard. SEPARATE from lead-specific voice.
//
// Permissions: role ADMIN && !leadOpsOnly (Lalit + real admins; NOT Sameer, NOT
// agents, NOT normal managers). Transcript is OPTIONAL — the audio ALWAYS saves
// even if transcription is absent/failed (never a blocker).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canSendBroadcast } from "@/lib/voiceBroadcast";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export const runtime = "nodejs";
const MAX_AUDIO = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!canSendBroadcast(me)) {
    return NextResponse.json({ error: "Only Lalit / an admin can send a voice broadcast." }, { status: 403 });
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

  const targetKindRaw = String(form.get("targetKind") ?? "").toUpperCase();
  const targetKind = (["ALL", "TEAM", "USER"] as const).includes(targetKindRaw as never) ? targetKindRaw as "ALL" | "TEAM" | "USER" : null;
  if (!targetKind) return NextResponse.json({ error: "Pick who to send to (Everyone / a Team / one agent)." }, { status: 400 });
  const targetTeam = targetKind === "TEAM" ? (String(form.get("targetTeam") ?? "").trim() || null) : null;
  const targetUserId = targetKind === "USER" ? (String(form.get("targetUserId") ?? "").trim() || null) : null;
  if (targetKind === "TEAM" && !["Dubai", "India"].includes(targetTeam ?? "")) {
    return NextResponse.json({ error: "Pick a valid team (Dubai or India)." }, { status: 400 });
  }
  if (targetKind === "USER" && !targetUserId) {
    return NextResponse.json({ error: "Pick an agent to send to." }, { status: 400 });
  }

  // Transcript + title are OPTIONAL. NEVER block the save on them.
  const transcript = (String(form.get("transcript") ?? "").trim()) || null;
  const title = (String(form.get("title") ?? "").trim()) || null;
  const durRaw = Number(form.get("durationSec"));
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
  const mimeType = (audio.type && audio.type.startsWith("audio/")) ? audio.type : "audio/webm";
  const buf = Buffer.from(await audio.arrayBuffer());

  const bc = await prisma.voiceBroadcast.create({
    data: { createdById: me.id, audioData: buf, mimeType, durationSec, transcript, title, targetKind, targetTeam, targetUserId },
    select: { id: true },
  });

  // Resolve recipients (active sales users only — never HR) and notify them.
  const recipientWhere =
    targetKind === "USER" ? { id: targetUserId! }
    : targetKind === "TEAM" ? { active: true, hrOnly: false, team: targetTeam! }
    : { active: true, hrOnly: false };
  const recipients = await prisma.user.findMany({ where: { ...recipientWhere, id: { not: me.id } }, select: { id: true } });
  const preview = transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open your dashboard to listen.";
  for (const r of recipients) {
    notify({
      userId: r.id, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `🎙 Voice message from ${me.name ?? "Admin"}`,
      body: title ? `${title} — ${preview}` : preview,
      linkUrl: `/dashboard`,
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.broadcast.send", entity: "VoiceBroadcast", entityId: bc.id,
    meta: { targetKind, targetTeam, targetUserId, recipients: recipients.length, bytes: buf.length, hasTranscript: !!transcript },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: bc.id, recipients: recipients.length });
}

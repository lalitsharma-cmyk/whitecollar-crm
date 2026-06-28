// /api/hr/candidates/[id]/voice — HR Voice Engine (mirror of the Sales Lead voice
// channels, shared shape with LeadVoiceMessage).
//
//   POST → record a voice message on a candidate. `kind` decides the flow:
//     GUIDANCE          (manager → owner)  requires hrCan("sendVoiceGuidance")
//     ESCALATION        (HR → manager)     requires hrCan("raiseEscalation"); opens/uses an HREscalation thread
//     ESCALATION_REPLY  (manager → HR)     requires hrCan("reviewEscalations"); flips thread → MANAGER_REPLIED
//   Stores the ORIGINAL audio bytes (≤5MB bytea) verbatim. Transcript is OPTIONAL and
//   NEVER blocks the save (Lalit rule). Writes an HRActivity for the candidate timeline.
//
//   GET  → list voice messages + escalation threads for the candidate. NEVER selects
//          audioData (metadata only — the audio streams from the /play sub-route).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedCandidate, hrCan } from "@/lib/hrAccess";
import { notify } from "@/lib/notify";
import { NotifKind, HRActivityType, VoiceMessageKind } from "@prisma/client";

export const runtime = "nodejs";
const MAX_AUDIO = 5 * 1024 * 1024; // 5 MB ≈ 5–8 min Opus

const preview = (t: string | null) =>
  t ? (t.length > 120 ? t.slice(0, 120) + "…" : t) : "Open the candidate to listen.";

// Active managers/reviewers who should hear about escalations (HR + Admin).
async function escalationReviewers(excludeId: string) {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      id: { not: excludeId },
      OR: [{ role: "ADMIN" }, { hrTeam: true }, { AND: [{ hrOnly: true }, { role: "MANAGER" }] }],
    },
    select: { id: true },
  });
  return users;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me, candidate } = access;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });

  const rawKind = String(form.get("kind") ?? "GUIDANCE").trim().toUpperCase();
  const kind = (["GUIDANCE", "ESCALATION", "ESCALATION_REPLY"] as const).includes(rawKind as never)
    ? (rawKind as VoiceMessageKind)
    : null;
  if (!kind) return NextResponse.json({ error: "Invalid voice message kind." }, { status: 400 });

  // Permission per kind (mirrors the Sales channels).
  if (kind === "GUIDANCE" && !hrCan(me, "sendVoiceGuidance"))
    return NextResponse.json({ error: "You can't record voice guidance." }, { status: 403 });
  if (kind === "ESCALATION" && !hrCan(me, "raiseEscalation"))
    return NextResponse.json({ error: "You can't raise an escalation." }, { status: 403 });
  if (kind === "ESCALATION_REPLY" && !hrCan(me, "reviewEscalations"))
    return NextResponse.json({ error: "Only a reviewer can reply to an escalation." }, { status: 403 });

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0)
    return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  if (audio.size > MAX_AUDIO)
    return NextResponse.json({ error: "Recording too long (max ~5 MB / 5–8 min). Please record a shorter clip." }, { status: 413 });

  const transcript = String(form.get("transcript") ?? "").trim() || null;
  const textNote = String(form.get("textNote") ?? "").trim() || null;
  const title = String(form.get("title") ?? "").trim() || null;
  const lang = String(form.get("lang") ?? "").trim() || null;
  const durRaw = Number(form.get("durationSec"));
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
  const mimeType = audio.type && audio.type.startsWith("audio/") ? audio.type : "audio/webm";
  const buf = Buffer.from(await audio.arrayBuffer());

  const cName = candidate.name;

  // ── GUIDANCE ──────────────────────────────────────────────────────────────
  if (kind === "GUIDANCE") {
    const msg = await prisma.hRVoiceMessage.create({
      data: { candidateId: id, kind, createdById: me.id, audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, title },
      select: { id: true },
    });
    await prisma.hRActivity.create({
      data: { candidateId: id, userId: me.id, type: HRActivityType.VOICE_GUIDANCE, notes: transcript ?? title ?? "Voice guidance recorded" },
    }).catch(() => {});

    // Ping the assigned owner(s) so they get the unread badge (skip self).
    const ownerIds = [candidate.primaryOwnerId, candidate.secondaryOwnerId].filter((x): x is string => !!x && x !== me.id);
    for (const uid of [...new Set(ownerIds)]) {
      notify({
        userId: uid, kind: NotifKind.SYSTEM, severity: "INFO",
        title: `🎤 Voice guidance from ${me.name ?? "Manager"} on ${cName}`,
        body: preview(transcript), linkUrl: `/hr/candidates/${id}`,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, id: msg.id, kind });
  }

  // ── ESCALATION (HR → manager) — find-or-create the OPEN thread ─────────────
  if (kind === "ESCALATION") {
    const open = await prisma.hREscalation.findFirst({
      where: { candidateId: id, status: { not: "RESOLVED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    const reason = (textNote ?? transcript ?? "Voice escalation").slice(0, 280);
    const escalation = open
      ? await prisma.hREscalation.update({
          where: { id: open.id },
          data: open.status === "MANAGER_REPLIED" ? { status: "PENDING" } : {},
          select: { id: true },
        })
      : await prisma.hREscalation.create({
          data: { candidateId: id, raisedById: me.id, reason, status: "PENDING" },
          select: { id: true },
        });

    const msg = await prisma.hRVoiceMessage.create({
      data: { candidateId: id, kind, createdById: me.id, escalationId: escalation.id, audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, textNote },
      select: { id: true },
    });
    await prisma.hRActivity.create({
      data: { candidateId: id, userId: me.id, type: HRActivityType.ESCALATION_RAISED, notes: transcript ?? textNote ?? "Escalation raised" },
    }).catch(() => {});

    const reviewers = await escalationReviewers(me.id);
    for (const r of reviewers) {
      notify({
        userId: r.id, kind: NotifKind.SYSTEM, severity: "WARNING",
        title: `🚨 Escalation from ${me.name ?? "HR"} on ${cName}`,
        body: preview(transcript), linkUrl: `/hr/candidates/${id}`,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, id: msg.id, escalationId: escalation.id, kind });
  }

  // ── ESCALATION_REPLY (manager → HR) ────────────────────────────────────────
  const escId = String(form.get("escalationId") ?? "").trim();
  const esc = escId
    ? await prisma.hREscalation.findFirst({ where: { id: escId, candidateId: id }, select: { id: true, status: true, raisedById: true } })
    : await prisma.hREscalation.findFirst({ where: { candidateId: id, status: { not: "RESOLVED" } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, raisedById: true } });
  if (!esc) return NextResponse.json({ error: "No open escalation to reply to." }, { status: 404 });
  if (esc.status === "RESOLVED") return NextResponse.json({ error: "This escalation is already resolved." }, { status: 409 });

  const msg = await prisma.hRVoiceMessage.create({
    data: { candidateId: id, kind, createdById: me.id, escalationId: esc.id, audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, textNote },
    select: { id: true },
  });
  await prisma.hREscalation.update({ where: { id: esc.id }, data: { status: "MANAGER_REPLIED" } });
  await prisma.hRActivity.create({
    data: { candidateId: id, userId: me.id, type: HRActivityType.ESCALATION_REPLIED, notes: transcript ?? textNote ?? "Manager replied" },
  }).catch(() => {});

  if (esc.raisedById && esc.raisedById !== me.id) {
    notify({
      userId: esc.raisedById, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `💬 ${me.name ?? "Manager"} replied to your escalation on ${cName}`,
      body: preview(transcript), linkUrl: `/hr/candidates/${id}`,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, id: msg.id, escalationId: esc.id, kind });
}

// PATCH → mark a GUIDANCE message as understood by the current viewer (parity with
// the Sales "Mark as understood" badge). Body: { messageId }. Idempotent.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;

  const body = await req.json().catch(() => ({}));
  const messageId = String(body?.messageId ?? "").trim();
  if (!messageId) return NextResponse.json({ error: "messageId required." }, { status: 400 });

  const msg = await prisma.hRVoiceMessage.findFirst({ where: { id: messageId, candidateId: id }, select: { id: true } });
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.hRVoiceMessageRead.upsert({
    where: { voiceMessageId_userId: { voiceMessageId: messageId, userId: me.id } },
    create: { voiceMessageId: messageId, userId: me.id },
    update: {},
  });
  return NextResponse.json({ ok: true });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;

  const [messages, escalations] = await Promise.all([
    prisma.hRVoiceMessage.findMany({
      where: { candidateId: id }, // NEVER select audioData here.
      orderBy: { createdAt: "asc" },
      select: {
        id: true, kind: true, createdById: true, durationSec: true, transcript: true,
        textNote: true, title: true, escalationId: true, createdAt: true,
        reads: { select: { userId: true } },
      },
    }),
    prisma.hREscalation.findMany({
      where: { candidateId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, reason: true, status: true, raisedById: true, resolvedById: true, resolvedAt: true, createdAt: true },
    }),
  ]);

  // Resolve creator names in one pass (HRVoiceMessage has no createdBy relation).
  const userIds = [...new Set([...messages.map((m) => m.createdById), ...escalations.map((e) => e.raisedById)])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = (uid: string | null) => (uid ? users.find((u) => u.id === uid)?.name ?? "Unknown" : "Unknown");

  return NextResponse.json({
    me: { id: me.id },
    messages: messages.map((m) => ({
      id: m.id,
      kind: m.kind,
      by: nameOf(m.createdById),
      at: m.createdAt.toISOString(),
      transcript: m.transcript,
      textNote: m.textNote,
      title: m.title,
      durationSec: m.durationSec,
      escalationId: m.escalationId,
      mine: m.createdById === me.id,
      understood: m.reads.some((r) => r.userId === me.id),
    })),
    escalations: escalations.map((e) => ({
      id: e.id,
      reason: e.reason,
      status: e.status,
      raisedBy: nameOf(e.raisedById),
      raisedById: e.raisedById,
      resolvedAt: e.resolvedAt ? e.resolvedAt.toISOString() : null,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}

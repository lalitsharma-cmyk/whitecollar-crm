// POST /api/leads/[id]/escalation — Channel ② "Escalation Thread": an agent raises
// (or adds to) a voice escalation to the manager. Stores the ORIGINAL audio bytes
// (≤5MB bytea) verbatim + the browser transcript, exactly like Channel ①. Notifies
// every admin/manager so Lalit gets the unread badge. One OPEN thread per lead:
// a second raise on an already-open thread appends to it (and, if the manager had
// replied, flips it back to PENDING so it re-surfaces for the manager).
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
  const textNote = (String(form.get("textNote") ?? "").trim()) || null;
  const lang = (String(form.get("lang") ?? "").trim()) || null;
  const durRaw = Number(form.get("durationSec"));
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : null;
  const mimeType = (audio.type && audio.type.startsWith("audio/")) ? audio.type : "audio/webm";
  const buf = Buffer.from(await audio.arrayBuffer());

  // Find-or-create the OPEN thread for this lead (status != RESOLVED).
  const open = await prisma.leadEscalation.findFirst({
    where: { leadId: id, status: { not: "RESOLVED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, raisedById: true },
  });
  const reason = textNote ?? transcript ?? "Voice escalation";
  const escalation = open
    ? await prisma.leadEscalation.update({
        // A fresh agent message re-opens it for the manager if they'd already replied.
        where: { id: open.id },
        data: open.status === "MANAGER_REPLIED" ? { status: "PENDING" } : {},
        select: { id: true },
      })
    : await prisma.leadEscalation.create({
        data: { leadId: id, raisedById: me.id, reason: reason.slice(0, 280), status: "PENDING" },
        select: { id: true },
      });

  const msg = await prisma.leadVoiceMessage.create({
    data: {
      leadId: id, kind: "ESCALATION", createdById: me.id, escalationId: escalation.id,
      audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, textNote,
    },
    select: { id: true },
  });

  // Notify every active admin/manager (the escalation goes UP). Skip self.
  const managers = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER"] }, id: { not: me.id } },
    select: { id: true },
  });
  const preview = transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open the lead to listen.";
  for (const m of managers) {
    notify({
      userId: m.id, kind: NotifKind.SYSTEM, severity: "WARNING",
      title: `🚨 Escalation from ${me.name ?? "Agent"} on ${lead.name}`,
      body: preview, linkUrl: `/leads/${id}`, leadId: id,
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.escalation.raise", entity: "Lead", entityId: id,
    meta: { escalationId: escalation.id, msgId: msg.id, bytes: buf.length, reopened: !!open }, request: reqMeta(req),
  }).catch(() => {});
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});

  return NextResponse.json({ ok: true, escalationId: escalation.id, id: msg.id });
}

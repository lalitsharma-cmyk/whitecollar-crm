// POST /api/buyer-data/[id]/escalation — Channel ② "Escalation Thread": the assigned
// agent raises (or adds to) a voice escalation to the manager on a buyer. Buyer-view
// parity with the lead escalation route. Stores the ORIGINAL audio bytes (≤5MB bytea)
// verbatim on BuyerVoiceMessage (kind ESCALATION) + notifies every admin/manager.
// One OPEN thread per buyer; a second raise appends (and re-opens if manager replied).
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

  // Find-or-create the OPEN thread for this buyer (status != RESOLVED).
  const open = await prisma.buyerEscalation.findFirst({
    where: { buyerId: id, status: { not: "RESOLVED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, raisedById: true },
  });
  const reason = textNote ?? transcript ?? "Voice escalation";
  const escalation = open
    ? await prisma.buyerEscalation.update({
        where: { id: open.id },
        data: open.status === "MANAGER_REPLIED" ? { status: "PENDING" } : {},
        select: { id: true },
      })
    : await prisma.buyerEscalation.create({
        data: { buyerId: id, raisedById: me.id, reason: reason.slice(0, 280), status: "PENDING" },
        select: { id: true },
      });

  const msg = await prisma.buyerVoiceMessage.create({
    data: {
      buyerId: id, kind: "ESCALATION", createdById: me.id, escalationId: escalation.id,
      audioData: buf, mimeType, durationSec, transcript, transcriptLang: lang, textNote,
    },
    select: { id: true },
  });

  // Notify every active admin/manager (the escalation goes UP). Skip self.
  const managers = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER"] }, id: { not: me.id } },
    select: { id: true },
  });
  const preview = transcript ? (transcript.length > 120 ? transcript.slice(0, 120) + "…" : transcript) : "Open the buyer to listen.";
  for (const m of managers) {
    notify({
      userId: m.id, kind: NotifKind.SYSTEM, severity: "WARNING",
      title: `🚨 Escalation from ${me.name ?? "Agent"} on buyer ${buyer.clientName}`,
      body: preview, linkUrl: `/buyer-data/${id}`,
    }).catch(() => {});
  }
  await audit({
    userId: me.id, action: "voice.escalation.raise", entity: "BuyerRecord", entityId: id,
    meta: { escalationId: escalation.id, msgId: msg.id, bytes: buf.length, reopened: !!open }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, escalationId: escalation.id, id: msg.id });
}

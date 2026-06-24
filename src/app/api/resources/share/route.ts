// Record a resource share — "which file was shared with which client, how".
//
//   POST /api/resources/share
//     body: { resourceId, leadId?, channel: WHATSAPP|EMAIL|ATTACH, recipient?, note? }
//
// Writes a ResourceShare row (the tracking record). When a leadId is supplied it
// is scoped to a lead the caller may touch, and the share is ALSO logged as an
// Activity on that lead so it appears in Conversation History (parity with the
// WhatsApp/email touch logging) and bumps lastTouchedAt.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResourceShareChannel, ActivityType, ActivityStatus } from "@prisma/client";
// (canTouchLead expects the lead's { ownerId, forwardedTeam }.)
import { canTouchLead } from "@/lib/leadScope";

export const dynamic = "force-dynamic";

const CHANNELS = new Set(["WHATSAPP", "EMAIL", "ATTACH"]);

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  const resourceId = String(body.resourceId ?? "").trim();
  const leadId = body.leadId ? String(body.leadId).trim() : null;
  const channelRaw = String(body.channel ?? "").trim().toUpperCase();
  const recipient = body.recipient ? String(body.recipient).trim().slice(0, 200) : null;
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  if (!resourceId) return NextResponse.json({ error: "resourceId required" }, { status: 400 });
  if (!CHANNELS.has(channelRaw)) return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
  const channel = channelRaw as ResourceShareChannel;

  // Resource must exist and be live.
  const resource = await prisma.resource.findUnique({
    where: { id: resourceId },
    select: { id: true, title: true, type: true, deletedAt: true },
  });
  if (!resource || resource.deletedAt) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  // If attached to a lead, the caller must be allowed to touch that lead.
  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, ownerId: true, forwardedTeam: true } });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const allowed = await canTouchLead(me, { ownerId: lead.ownerId, forwardedTeam: lead.forwardedTeam });
    if (!allowed) return NextResponse.json({ error: "Not allowed for this lead" }, { status: 403 });
  }

  const share = await prisma.resourceShare.create({
    data: { resourceId, leadId, sharedById: me.id, channel, recipient, note },
    select: { id: true, sharedAt: true },
  });

  // Mirror into the lead timeline (parity with WhatsApp/email touch logging).
  if (leadId) {
    const channelLabel = channel === "WHATSAPP" ? "WhatsApp" : channel === "EMAIL" ? "Email" : "CRM";
    await prisma.activity
      .create({
        data: {
          leadId,
          userId: me.id,
          type: ActivityType.BROCHURE_SENT, // semantic type for sharing collateral
          status: ActivityStatus.DONE,
          title: `📎 Shared "${resource.title}" via ${channelLabel}`,
          description: note || undefined,
          completedAt: new Date(),
        },
      })
      .catch(() => {});
    await prisma.lead.update({ where: { id: leadId }, data: { lastTouchedAt: new Date() } }).catch(() => {});
  }

  return NextResponse.json({ ok: true, share }, { status: 201 });
}

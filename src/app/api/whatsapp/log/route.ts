// Logs every WhatsApp link click as an Activity. This is the best we can do
// without the Meta Cloud API — at least admin knows WHEN and WHO clicked
// "WhatsApp" on a lead, even though we can't see the actual message content.
//
// To upgrade to full WhatsApp-conversation tracking:
//   1. Sign up for Meta WhatsApp Business Account
//   2. Get a Cloud API access token + phone-number IDs (one per agent)
//      assigned to each User.companyWhatsAppNumber
//   3. Set WA_BUSINESS_TOKEN env var
//   4. Inbound messages flow into /api/intake/whatsapp already
//   5. Outbound messages: send via API instead of wa.me, then conversation
//      logging is automatic
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, WAMessageDirection } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const leadId = String(body.leadId ?? "");
  const kind = String(body.kind ?? "click");  // "click" | "send"
  const message = String(body.message ?? "").slice(0, 500);
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  // NOTE: logging a WhatsApp send no longer sets the follow-up date (Lalit's rule:
  // an agent must NEVER set/edit the follow-up while logging a conversation — the
  // follow-up changes ONLY via Complete / Snooze / Escalate / Reschedule / Admin).
  // We deliberately do NOT read, require, or persist `followupDate` here. After a
  // send, the UI opens the "What next?" popup so the agent closes the follow-up
  // through the shared action endpoints.

  const scoped = await loadOwnedLead(leadId);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  await prisma.activity.create({
    data: {
      leadId,
      userId: me.id,
      type: ActivityType.WHATSAPP,
      status: ActivityStatus.DONE,
      title: kind === "send" ? "💬 WhatsApp sent" : "💬 WhatsApp link opened",
      description: message || undefined,
      // No followupDate on the timeline entry — logging a WhatsApp send no longer
      // sets the follow-up (it's set only via Complete / Snooze / Escalate).
      completedAt: new Date(),
    },
  });
  // When the agent recorded WHAT they sent, also store it as an OUTBOUND
  // WhatsAppMessage so the text appears in Conversation History (consistent with
  // inbound WA), not only as a generic activity row.
  if (message) {
    const leadRow = await prisma.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
    if (leadRow?.phone) {
      await prisma.whatsAppMessage.create({
        data: { leadId, phoneNumber: leadRow.phone, direction: WAMessageDirection.OUTBOUND, body: message },
      }).catch(() => {});
    }
  }

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      lastTouchedAt: new Date(),
      // Follow-up is NOT touched here. Logging a WhatsApp send must not set or
      // change Lead.followupDate — that happens only via Complete / Snooze /
      // Escalate / Reschedule / Admin (the "What next?" popup opens after send).
    },
  });

  return NextResponse.json({ ok: true });
}

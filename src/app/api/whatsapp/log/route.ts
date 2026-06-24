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

  // Next follow-up date — MANDATORY when LOGGING an outbound WhatsApp interaction
  // (kind="send"). Mirrors the Log Conversation rule: every logged client touch
  // must leave a next action. The lightweight link-open tracking (kind="click",
  // from the alt-phone WA button) carries no outcome and is NOT a logged
  // interaction, so it is intentionally exempt — we don't change that behaviour.
  const followupRaw = body.followupDate ? String(body.followupDate) : "";
  const followupDate = followupRaw ? new Date(followupRaw) : null;
  if (kind === "send") {
    if (!followupRaw) {
      return NextResponse.json({ error: "Please set the next follow-up date." }, { status: 400 });
    }
    if (!followupDate || isNaN(followupDate.getTime()) || followupDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Follow-up time must be a valid future ISO datetime." }, { status: 400 });
    }
  }

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
      // Carry the follow-up on the timeline entry (kind="send" only) so the Smart
      // Timeline shows the "📅 Follow-up:" line, consistent with logged calls.
      ...(kind === "send" && followupDate ? { followupDate } : {}),
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
      // A logged WhatsApp send sets the next follow-up commitment, same as a call.
      // Reset the dedupe flag so the 10-min pre-followup push fires for this time.
      ...(kind === "send" && followupDate ? { followupDate, followupReminderSentAt: null } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

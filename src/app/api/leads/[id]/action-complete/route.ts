import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { awardXp, bumpStreak, type AwardResult } from "@/lib/gamification.server";
import { contactActivityTodayInfo } from "@/lib/followupGate";

/**
 * POST /api/leads/[id]/action-complete
 *
 * "Complete" button on the Action List card. Marks the current follow-up done:
 *   • lastTouchedAt → now (so the SLA clock + "untouched" feed reset)
 *   • followupDate / followupReminderSentAt cleared (item drops off Overdue / Today)
 *   • needsManagerReview cleared if the agent themselves handled it
 *   • Activity row added so the timeline shows the manual complete
 *   • XP + follow-up streak awarded
 *
 * ── COMPLETION GATE (Lalit's policy) ──────────────────────────────────────────
 * An AGENT may NOT complete a follow-up without first logging a real client touch
 * (call / WhatsApp / email) TODAY (IST). We enforce it server-side so a tampered
 * request can't bypass the disabled UI button. Admins/Managers MAY bypass (for
 * data corrections — e.g. closing a follow-up an agent forgot to). The contact
 * channel + connected flag are recorded on the completion Activity (actionContext)
 * so the EOD report can bucket "completed after call" vs "after whatsapp".
 *
 * Body (optional):
 *   { note?: string }  – free-text note shown in the timeline + on the card
 *
 * Returns the standard `awardedXp` payload so LeadActionsClient-style toasts
 * can fire on the client.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const body = await req.json().catch(() => ({}));
  const note = String(body.note ?? "").trim();

  // ── Gate: agents must have logged a contact attempt today before completing.
  //    Admins/Managers bypass (corrections). Compute the channel/connected info
  //    once — we both gate on it AND record it on the completion Activity.
  const contact = await contactActivityTodayInfo(id);
  if (me.role === "AGENT" && !contact.has) {
    return NextResponse.json(
      { error: "You cannot complete this follow-up without logging a call, WhatsApp, or email attempt first.", contactRequired: true },
      { status: 400 },
    );
  }

  const now = new Date();

  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: now,
      followupDate: null,
      followupReminderSentAt: null,
      needsManagerReview: false,
      managerReviewReason: null,
      slaEscalated: false,
    },
  });

  // actionContext token for the report: "complete:<channel>" or "complete:none"
  // (the latter only reachable by an admin/manager bypassing the gate).
  const channelToken = contact.channel ? contact.channel.toLowerCase() : "none";

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.TASK,
      status: ActivityStatus.DONE,
      title: "✅ Follow-up completed",
      description: note || (contact.has
        ? `Closed after ${contact.channel?.toLowerCase() ?? "contact"}${contact.connected ? " (connected)" : ""}`
        : null),
      actionContext: `complete:${channelToken}`,
      completedAt: now,
    },
  });

  // Gamification – follow-up streak + XP. Fire-and-forget streak; keep the
  // XP award awaited so we can return it to the client for the toast.
  let awarded: AwardResult | null = null;
  try {
    awarded = await awardXp(me.id, "FOLLOWUP_COMPLETED");
    bumpStreak(me.id, "followup").catch(() => {});
    bumpStreak(me.id, "daily").catch(() => {});
  } catch {
    // never let gamification break the action
  }

  return NextResponse.json({
    ok: true,
    leadName: lead.name,
    awardedXp: awarded
      ? {
          amount: awarded.awarded,
          label: awarded.label,
          newXp: awarded.newXp,
          leveledUp: awarded.leveledUp,
          newLevel: awarded.leveledUp ? awarded.newLevel : null,
        }
      : null,
  });
}

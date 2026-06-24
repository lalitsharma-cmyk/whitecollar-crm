import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { notify } from "@/lib/notify";

/**
 * POST /api/leads/[id]/action-escalate
 *
 * "Escalate" button on the Action List card AND the Lead-View header. Flags the
 * lead for manager intervention so it appears in Lalit's "🚩 NEED YOUR
 * ATTENTION" section and on the dashboard's Today's-Situation strip.
 *
 * Sets needsManagerReview=true with a reason so the manager card explains
 * why the agent kicked it upward. We also bump `flaggedAt` to now so the
 * ordering in the manager's queue is correct. The lead owner's manager +
 * all admins are notified (in-app + push) so an escalation reaches a human
 * immediately rather than only surfacing the next time they open the board.
 *
 * Idempotent — re-escalating just updates the reason + flaggedAt.
 *
 * Shared by /action-list (ActionCardClient) and /leads/[id] (LeadFollowupActions)
 * — one endpoint, one behaviour, DRY.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim()
    || "Agent escalated from Action List";

  const now = new Date();
  await prisma.lead.update({
    where: { id },
    data: {
      needsManagerReview: true,
      managerReviewReason: reason,
      flaggedAt: now,
    },
  });

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: "🆘 Follow-up escalated to manager",
      description: reason,
      actionContext: "escalate",
      completedAt: now,
    },
  });

  // ── Notify the manager + admins (best-effort; never blocks the escalation) ──
  // Mirror the reject-route recipient pattern: lead-owner's manager-of-record
  // plus every active admin, minus the escalator themselves.
  try {
    const owner = lead.ownerId
      ? await prisma.user.findUnique({ where: { id: lead.ownerId }, select: { name: true, managerId: true } })
      : null;
    const recipientIds = new Set<string>();
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    for (const a of admins) recipientIds.add(a.id);
    if (owner?.managerId) recipientIds.add(owner.managerId);
    recipientIds.delete(me.id);

    const ownerLabel = owner?.name ?? "(unassigned)";
    for (const uid of recipientIds) {
      notify({
        userId: uid,
        kind: "REMINDER",
        severity: "WARNING",
        title: `🆘 ${lead.name} escalated by ${me.name}`,
        body: `Owner: ${ownerLabel} · Reason: ${reason}`,
        linkUrl: `/leads/${id}`,
        leadId: id,
      }).catch(() => {});
    }
  } catch {
    // notification failure must never roll back a legitimate escalation
  }

  return NextResponse.json({
    ok: true,
    leadName: lead.name,
    flaggedAt: now.toISOString(),
    reason,
  });
}

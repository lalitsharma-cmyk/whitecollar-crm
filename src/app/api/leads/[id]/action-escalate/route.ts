import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * POST /api/leads/[id]/action-escalate
 *
 * "Escalate" button on the Action List card. Flags the lead for manager
 * intervention so it appears in Lalit's "🚩 NEED YOUR ATTENTION" section
 * and on the dashboard's Today's-Situation strip.
 *
 * Sets needsManagerReview=true with a reason so the manager card explains
 * why the agent kicked it upward. We also bump `flaggedAt` to now so the
 * ordering in the manager's queue is correct.
 *
 * Idempotent — re-escalating just updates the reason + flaggedAt.
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
      title: "🆘 Escalated to manager",
      description: reason,
      completedAt: now,
    },
  });

  return NextResponse.json({
    ok: true,
    leadName: lead.name,
    flaggedAt: now.toISOString(),
    reason,
  });
}

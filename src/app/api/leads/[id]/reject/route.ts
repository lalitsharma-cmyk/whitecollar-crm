import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * POST /api/leads/[id]/reject
 *
 * Marks the lead LOST with a structured rejection reason. Lalit's ask: "There
 * is no option to reject a lead. Rejection reasons also should be specified
 * in dropdown as: Fund Issue, War Fear, Low Budget, Look after 2 years,
 * Waiting for selling his property, and Other option where manually can be
 * entered."
 *
 * Side-effects:
 *   • status → LOST
 *   • followupDate cleared so a rejected lead doesn't show in Today's
 *     follow-ups or feed reminders
 *   • Activity row added so the rejection appears in Timeline
 *   • rejectedAt + rejectedById captured for the SLA / funnel-leakage report
 */
const REASONS = new Set([
  "FUND_ISSUE",
  "WAR_FEAR",
  "LOW_BUDGET",
  "LOOK_AFTER_2_YEARS",
  "WAITING_FOR_PROPERTY_SALE",
  "OTHER",
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").toUpperCase();
  const note = String(body.note ?? "").trim();

  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }
  if (reason === "OTHER" && !note) {
    return NextResponse.json({ error: "Note is required when reason is OTHER" }, { status: 400 });
  }

  const now = new Date();
  await prisma.lead.update({
    where: { id },
    data: {
      status: LeadStatus.LOST,
      rejectionReason: reason,
      rejectionNote: note || null,
      rejectedAt: now,
      rejectedById: me.id,
      followupDate: null,             // clear so it stops showing in Today's queue
      followupReminderSentAt: null,
      lastTouchedAt: now,
    },
  });

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: `❌ Rejected · ${reason.replaceAll("_", " ")}`,
      description: note || null,
      completedAt: now,
    },
  });

  return NextResponse.json({
    ok: true,
    lead: { id, status: "LOST", rejectionReason: reason, rejectionNote: note || null, rejectedAt: now.toISOString() },
    leadName: lead.name,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { audit, reqMeta } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { REJECT_REASON_VALUES, rejectReasonLabel, rejectionStatusFor } from "@/lib/reject-reasons";

/**
 * POST /api/leads/[id]/reject
 *
 * Marks the lead LOST with a structured rejection reason. Lalit's ask: "There
 * is no option to reject a lead. Rejection reasons also should be specified
 * in dropdown as: Fund Issue, War Fear, Low Budget, Look after 2 years,
 * Waiting for selling his property, and Other option where manually can be
 * entered."
 *
 * Auth:
 *   • Owner / admin / manager-in-tree can reject (delegated to canTouchLead)
 *   • Anyone else → 404 (don't confirm the lead exists)
 *
 * Side-effects:
 *   • status → LOST
 *   • rejection{Reason,Note,At,ById} populated
 *   • followupDate cleared so the lead disappears from Today's queue
 *   • Activity (STATUS_CHANGE) added so the rejection appears in Timeline
 *   • AuditLog (action="lead.reject") for the forensic trail
 *   • notify() admin/manager so they have oversight
 */

// Reasons + labels live in src/lib/reject-reasons.ts (shared with the modal).
const NOTE_MAX = 500;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  // Look up the lead first so we can pass it to canTouchLead. We pull
  // ownerId for the scope check + name/owner/manager for downstream notifies.
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      ownerId: true,
      currentStatus: true,
      rejectedAt: true,
      owner: { select: { id: true, name: true, managerId: true } },
    },
  });
  // 404 (not 403) for everything — never confirm existence to outsiders.
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canTouchLead(me, lead))) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  // Prevent DOUBLE rejection — an already-rejected lead (rejectedAt stamped) must be
  // Reactivated before it can be rejected again (Rejected-Lead workflow 2026-06-27).
  if (lead.rejectedAt) {
    return NextResponse.json({ error: "This lead is already rejected — reactivate it first." }, { status: 400 });
  }

  // Parse + validate the body.
  const body = await req.json().catch(() => ({} as { reason?: unknown; note?: unknown }));
  const reason = typeof body.reason === "string" ? body.reason.toUpperCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!REJECT_REASON_VALUES.has(reason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }
  // Remarks are now REQUIRED — we must capture WHY the lead was rejected.
  if (!note) {
    return NextResponse.json({ error: "Reject remarks are required." }, { status: 400 });
  }
  if (note.length > NOTE_MAX) {
    return NextResponse.json({ error: `Remarks must be ${NOTE_MAX} characters or fewer` }, { status: 400 });
  }

  const now = new Date();
  const reasonLabel = rejectReasonLabel(reason);
  // The rejection reason is also the lead's new classification status — these
  // outcome statuses are not agent-selectable in the normal dropdown, so the
  // reject flow is the controlled way they get applied.
  const newStatus = rejectionStatusFor(reason);

  // Single update — everything lost-related in one write. lastTouchedAt is
  // bumped so the lead doesn't get flagged as "ghosting" right after rejection.
  await prisma.lead.update({
    where: { id },
    data: {
      currentStatus: newStatus,
      rejectionReason: reason,
      rejectionNote: note,
      rejectedAt: now,
      rejectedById: me.id,
      // UNASSIGN on reject (Lalit's final rule 2026-06-27): the lead becomes
      // Unassigned and the owner-at-rejection is preserved as previousOwnerId for the
      // "Previous Owner" display + permanent audit. Per-agent Rejected/Lost reporting
      // attributes via previousOwnerId (agentPerformance), so attribution is kept; the
      // Assignment-history rows already hold the full ownership timeline.
      previousOwnerId: lead.ownerId,
      ownerId: null,
      assignedAt: null,
      followupDate: null,
      followupReminderSentAt: null,
      lastTouchedAt: now,
    },
  });

  // Timeline entry — type STATUS_CHANGE per spec; the title includes the
  // human label so admins scanning the activity log see "War Fear", not
  // an enum constant.
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `Lead rejected: ${reasonLabel}`,
      description: note,
      completedAt: now,
    },
  });

  // Conversation-history entry — a NOTE (rendered in the Conversation stream
  // with the agent's name + IST time). Added as a NEW entry; never replaces the
  // lead's existing remarks.
  await prisma.note.create({
    data: {
      leadId: id,
      userId: me.id,
      body: `🚫 Rejected Lead\nReason: ${reasonLabel}\nRemarks: ${note}`,
    },
  }).catch(() => {});

  // Audit — forensic trail kept independently of Activity so a deleted lead
  // still leaves a record.
  await audit({
    userId: me.id,
    action: "lead.reject",
    entity: "Lead",
    entityId: id,
    meta: {
      reason,
      hasNote: !!note,
      previousStatus: lead.currentStatus,
      ownerId: lead.ownerId,
    },
    request: { ...reqMeta(req) },
  });

  // Notify admins + the owner's manager (if any) so oversight stays
  // continuous. We DON'T notify the rejecting user, and we dedupe in the
  // (rare) case the rejector is also the manager-of-record.
  const recipientIds = new Set<string>();
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", active: true },
    select: { id: true },
  });
  for (const a of admins) recipientIds.add(a.id);
  if (lead.owner?.managerId) recipientIds.add(lead.owner.managerId);
  recipientIds.delete(me.id);

  const ownerLabel = lead.owner?.name ?? "(unassigned)";
  const labelHuman = reasonLabel;
  for (const uid of recipientIds) {
    // Fire-and-forget per the rest of the codebase — a notify failure must
    // never roll back a legitimate rejection.
    notify({
      userId: uid,
      kind: "SYSTEM",
      severity: "INFO",
      title: `Lead rejected · ${lead.name}`,
      body: `${me.name} rejected ${lead.name} (owner: ${ownerLabel}) · Reason: ${labelHuman}`,
      linkUrl: `/admin/rejected-leads`,
      leadId: id,
      // Important enough to land in inbox too — admins want oversight without
      // having to crawl the in-app bell.
      email: false,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

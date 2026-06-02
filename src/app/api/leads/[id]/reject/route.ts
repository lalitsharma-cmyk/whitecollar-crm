import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { audit, reqMeta } from "@/lib/audit";
import { notify } from "@/lib/notify";

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

// Allowed reasons — kept in sync with the modal options. OTHER requires note.
const REASONS = new Set([
  "FUND_ISSUE",
  "WAR_FEAR",
  "LOW_BUDGET",
  "LOOK_AFTER_2_YEARS",
  "WAITING_FOR_PROPERTY_SALE",
  "OTHER",
]);

// Human-readable labels mirrored from the client modal — used in notification
// + activity titles so admins/managers see "Low budget" not "LOW_BUDGET".
const REASON_LABEL: Record<string, string> = {
  FUND_ISSUE: "Fund issue",
  WAR_FEAR: "War / market fear",
  LOW_BUDGET: "Low budget",
  LOOK_AFTER_2_YEARS: "Look after 2 years",
  WAITING_FOR_PROPERTY_SALE: "Waiting for property sale",
  OTHER: "Other",
};

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
      status: true,
      owner: { select: { id: true, name: true, managerId: true } },
    },
  });
  // 404 (not 403) for everything — never confirm existence to outsiders.
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canTouchLead(me, lead))) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Parse + validate the body.
  const body = await req.json().catch(() => ({} as { reason?: unknown; note?: unknown }));
  const reason = typeof body.reason === "string" ? body.reason.toUpperCase() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";

  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
  }
  if (reason === "OTHER" && !note) {
    return NextResponse.json({ error: "Note is required when reason is OTHER" }, { status: 400 });
  }
  if (note.length > NOTE_MAX) {
    return NextResponse.json({ error: `Note must be ${NOTE_MAX} characters or fewer` }, { status: 400 });
  }

  const now = new Date();

  // Single update — everything lost-related in one write. lastTouchedAt is
  // bumped so the lead doesn't get flagged as "ghosting" right after rejection.
  await prisma.lead.update({
    where: { id },
    data: {
      status: LeadStatus.LOST,
      rejectionReason: reason,
      rejectionNote: note || null,
      rejectedAt: now,
      rejectedById: me.id,
      followupDate: null,
      followupReminderSentAt: null,
      lastTouchedAt: now,
    },
  });

  // Timeline entry — type STATUS_CHANGE per spec; the title includes the
  // human label so admins scanning the activity log see "Low budget", not
  // an enum constant.
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `Lead rejected: ${REASON_LABEL[reason] ?? reason}`,
      description: note || null,
      completedAt: now,
    },
  });

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
      previousStatus: lead.status,
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
  const labelHuman = REASON_LABEL[reason] ?? reason;
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

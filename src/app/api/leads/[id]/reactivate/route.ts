import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { ActivityType, ActivityStatus } from "@prisma/client";

/**
 * POST /api/leads/[id]/reactivate
 *
 * Reactivates an archived (LOST) lead by setting status back to NEW.
 * Only ADMIN and MANAGER roles are permitted.
 *
 * Side-effects:
 *   - status → NEW
 *   - lastTouchedAt → now
 *   - AuditLog (action="lead.reactivate")
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const me = await requireUser();

  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, status: true },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  await prisma.lead.update({
    where: { id },
    data: {
      status: "NEW",
      lastTouchedAt: new Date(),
    },
  });

  // Log the reopen to Conversation History (Raw + Smart Timeline) — was previously
  // only in the audit log, so reopening a lead was invisible on the timeline.
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: "♻️ Lead reopened",
      description: `Reopened by ${me.name ?? "agent"} — status set back to NEW.`,
      completedAt: new Date(),
    },
  }).catch(() => {});

  await audit({
    userId: me.id,
    action: "lead.reactivate",
    entity: "Lead",
    entityId: id,
    meta: { leadId: id },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { notify } from "@/lib/notify";

// POST /api/leads/[id]/eoi/approve — admin/manager sign-off for a booking
// whose flow was paused with eoiApprovalRequired = true. Stamps approver +
// timestamp, clears the flag, and notifies the owning agent so they can move
// the booking forward.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Forbidden — admin or manager only" }, { status: 403 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true, eoiApprovalRequired: true, eoiStage: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const now = new Date();
  const updated = await prisma.lead.update({
    where: { id },
    data: {
      eoiApprovedById: me.id,
      eoiApprovedAt: now,
      eoiApprovalRequired: false,
      lastTouchedAt: now,
    },
  });

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: "EOI approved",
      description: `Booking approved by ${me.name} at stage ${lead.eoiStage ?? "—"}`,
      completedAt: now,
    },
  });

  // Notify the owning agent (if any). Don't notify the approver themselves
  // when they happen to also be the owner.
  if (lead.ownerId && lead.ownerId !== me.id) {
    notify({
      userId: lead.ownerId,
      kind: "SYSTEM",
      severity: "INFO",
      title: `✅ EOI approved for ${lead.name}`,
      body: `${me.name} signed off on the booking. You can advance to the next stage.`,
      linkUrl: `/leads/${id}`,
      leadId: id,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, lead: updated });
}

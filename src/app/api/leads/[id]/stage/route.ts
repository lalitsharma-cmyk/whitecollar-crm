import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const newStatus = String(body.status ?? "");
  if (!(Object.values(LeadStatus) as string[]).includes(newStatus)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.status === newStatus) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.lead.update({ where: { id }, data: { status: newStatus as LeadStatus, lastTouchedAt: new Date() } });
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `Stage changed: ${lead.status.replaceAll("_", " ")} → ${newStatus.replaceAll("_", " ")}`,
      completedAt: new Date(),
    },
  });
  // Fire-and-forget behavioural re-score
  rescoreLead(id).catch(() => {});
  // Workflow engine: STATUS_CHANGED rules can fire WA/email/tasks etc.
  fireWorkflowTrigger("STATUS_CHANGED", id, { newStatus, previousStatus: lead.status }).catch(() => {});
  return NextResponse.json({ ok: true });
}

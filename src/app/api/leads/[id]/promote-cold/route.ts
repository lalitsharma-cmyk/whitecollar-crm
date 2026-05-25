// Cold-data → Active Lead promotion.
// Flips isColdCall=false, bumps status to CONTACTED if currently NEW,
// writes a COLD_TO_LEAD activity so the daily report can count conversions.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { ActivityType, ActivityStatus, LeadStatus } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  // Read full lead so we can decide on status bump
  const full = await prisma.lead.findUnique({ where: { id }, select: { status: true, isColdCall: true } });
  if (!full) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!full.isColdCall) return NextResponse.json({ error: "Already a lead, not cold" }, { status: 400 });

  const now = new Date();
  const nextStatus = full.status === LeadStatus.NEW ? LeadStatus.CONTACTED : full.status;

  await prisma.lead.update({
    where: { id },
    data: {
      isColdCall: false,
      coldCallReason: null,
      status: nextStatus,
      lastTouchedAt: now,
    },
  });
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.COLD_TO_LEAD,
      status: ActivityStatus.DONE,
      title: `❄ → 🔥 Promoted cold-data prospect to active lead`,
      description: `${lead.name} (${lead.phone ?? "no phone"}) — connected and qualified by ${me.name}`,
      completedAt: now,
    },
  });
  await audit({
    userId: me.id, action: "cold.promote", entity: "Lead", entityId: id,
    meta: { leadName: lead.name }, request: reqMeta(req),
  });
  // Workflow engine: fire any COLD_PROMOTED rules (e.g. auto-create welcome task)
  fireWorkflowTrigger("COLD_PROMOTED", id).catch(() => {});
  return NextResponse.json({ ok: true });
}

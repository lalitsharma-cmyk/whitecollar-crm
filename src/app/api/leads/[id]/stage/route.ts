import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getBantGateMode } from "@/lib/settings";
import { evaluateBantGate } from "@/lib/bantGate";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const newStatus = String(body.status ?? "");
  // Optional free-text "What changed?" note that accompanies a status change.
  // Stored in the STATUS_CHANGE activity description so the manager sees WHY the
  // status moved, not just THAT it did. Trimmed + capped so a paste of a giant
  // blob doesn't bloat the timeline.
  const changeNote = String(body.changeNote ?? "").trim().slice(0, 500);
  if (!(Object.values(LeadStatus) as string[]).includes(newStatus)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.status === newStatus) return NextResponse.json({ ok: true, unchanged: true });

  // BANT stage-gate. `lead` is a full row, so its budgetMin/authorityLevel/
  // needSummary/whenCanInvest satisfy BantFields structurally. Default mode is
  // SOFT (warn-but-allow); only HARD blocks the move with a 422.
  const bantMode = await getBantGateMode();
  const gate = evaluateBantGate({ targetStatus: newStatus, lead, mode: bantMode });
  if (gate.blocked) {
    return NextResponse.json({ error: gate.message, bantBlocked: true, missing: gate.missing }, { status: 422 });
  }

  await prisma.lead.update({ where: { id }, data: { status: newStatus as LeadStatus, lastTouchedAt: new Date() } });
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `Stage changed: ${lead.status.replaceAll("_", " ")} → ${newStatus.replaceAll("_", " ")}`,
      description: changeNote || null,
      completedAt: new Date(),
    },
  });
  // Fire-and-forget behavioural re-score
  rescoreLead(id).catch(() => {});
  // Workflow engine: STATUS_CHANGED rules can fire WA/email/tasks etc.
  fireWorkflowTrigger("STATUS_CHANGED", id, { newStatus, previousStatus: lead.status }).catch(() => {});
  // SOFT mode: the move was allowed but surface the warning so the UI can nudge
  // the agent to capture the missing BANT. HARD already returned 422 above; OFF
  // and fully-captured leads leave `gate.warn` false → no extra keys.
  return NextResponse.json({ ok: true, ...(gate.warn ? { bantWarning: gate.message, missing: gate.missing } : {}) });
}

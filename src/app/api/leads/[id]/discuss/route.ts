import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadProjectStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

// Add a project to the "Projects Discussed" list on a lead.
// Idempotent: if already added, just bumps discussedAt + (optionally) updates status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId ?? "").trim();
  const statusRaw = String(body.status ?? "DISCUSSED");
  const status = (Object.values(LeadProjectStatus) as string[]).includes(statusRaw)
    ? (statusRaw as LeadProjectStatus) : LeadProjectStatus.DISCUSSED;
  const notes = body.notes ? String(body.notes).trim() : undefined;
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const [lead, project] = await Promise.all([
    prisma.lead.findUnique({ where: { id } }),
    prisma.project.findUnique({ where: { id: projectId } }),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  await prisma.leadProject.upsert({
    where: { leadId_projectId: { leadId: id, projectId } },
    create: { leadId: id, projectId, status, notes, discussedAt: new Date() },
    update: { status, notes, discussedAt: new Date() },
  });
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.PROJECT_DISCUSSED,
      status: ActivityStatus.DONE,
      title: `Discussed: ${project.name}`,
      description: notes,
      completedAt: new Date(),
    },
  });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  await prisma.leadProject.deleteMany({ where: { leadId: id, projectId } });
  return NextResponse.json({ ok: true });
}

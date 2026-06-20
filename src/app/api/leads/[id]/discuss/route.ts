import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadProjectStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { userCanAccessProjectCountry } from "@/lib/propertyScope";

// Add a project to the "Projects Discussed" list on a lead.
// Idempotent: if already added, just bumps discussedAt + (optionally) updates status.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId ?? "").trim();
  // Free-text project name — lets an agent record a project that isn't in the
  // Master yet (e.g. "Damac Expo") instead of being blocked. Resolved below.
  const projectName = String(body.projectName ?? "").trim();

  // action="accept" — approve an auto-detected suggestion (suggestion=true → false).
  // No status/notes change; just marks it as confirmed by the user. Needs an id.
  if (body.action === "accept") {
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    await prisma.leadProject.update({
      where: { leadId_projectId: { leadId: id, projectId } },
      data: { suggestion: false, discussedAt: new Date() },
    });
    await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }

  if (!projectId && !projectName) {
    return NextResponse.json({ error: "projectId or projectName required" }, { status: 400 });
  }

  const statusRaw = String(body.status ?? "DISCUSSED");
  const status = (Object.values(LeadProjectStatus) as string[]).includes(statusRaw)
    ? (statusRaw as LeadProjectStatus) : LeadProjectStatus.DISCUSSED;
  const notes = body.notes ? String(body.notes).trim() : undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, city: true, country: true, forwardedTeam: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Resolve the project: by id → by existing name (case-insensitive) → create a
  // MANUAL, INACTIVE project for a brand-new free-text entry. active:false keeps
  // these ad-hoc names out of the lead auto-classifier / routing (which reads
  // only active projects), so the Master Data stays clean while the agent's note
  // still saves, appears, and persists.
  let project = projectId
    ? await prisma.project.findUnique({ where: { id: projectId } })
    : await prisma.project.findFirst({ where: { name: { equals: projectName, mode: "insensitive" } } });
  if (!project && projectName) {
    project = await prisma.project.create({
      data: {
        name: projectName.slice(0, 120),
        city: lead.city ?? "",
        country: lead.country ?? (lead.forwardedTeam === "India" ? "India" : "UAE"),
        active: false,
        source: "manual",
      },
    });
  }
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Market guard (server-side — UI filtering is bypassable). An AGENT may only
  // attach a project from the lead's market; Admin/Manager may cross markets.
  if (!userCanAccessProjectCountry(me, project.country, lead)) {
    return NextResponse.json({ error: "That project belongs to another market and can't be added to this lead." }, { status: 403 });
  }

  // Manual add or status update: suggestion=false (user explicitly chose this project)
  await prisma.leadProject.upsert({
    where: { leadId_projectId: { leadId: id, projectId: project.id } },
    create: { leadId: id, projectId: project.id, status, notes, discussedAt: new Date(), suggestion: false },
    update: { status, notes, discussedAt: new Date(), suggestion: false },
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
  return NextResponse.json({ ok: true, projectId: project.id, projectName: project.name });
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

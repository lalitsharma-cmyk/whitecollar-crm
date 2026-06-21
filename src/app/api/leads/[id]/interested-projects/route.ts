import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { userCanAccessProjectCountry } from "@/lib/propertyScope";

// "Interested Properties" — an INDEPENDENT store from "Properties Discussed"
// (/discuss → LeadProject). Same picker toolkit (search / scan / manual), but its
// own table (LeadInterestedProject) so the two lists never affect each other: a
// client may have discussed 10 projects yet be interested in only 2.
// Idempotent: re-posting the same project just bumps interestedAt.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  const projectId = String(body.projectId ?? "").trim();
  // Free-text project name — lets an agent record a property that isn't in the
  // Master yet instead of being blocked. Resolved (find-or-create) below.
  const projectName = String(body.projectName ?? "").trim();

  // action="accept" — confirm an auto-detected (Scan) suggestion (suggestion=true → false).
  if (body.action === "accept") {
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    await prisma.leadInterestedProject.update({
      where: { leadId_projectId: { leadId: id, projectId } },
      data: { suggestion: false, interestedAt: new Date() },
    });
    await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } });
    return NextResponse.json({ ok: true });
  }

  if (!projectId && !projectName) {
    return NextResponse.json({ error: "projectId or projectName required" }, { status: 400 });
  }
  const notes = body.notes ? String(body.notes).trim() : undefined;

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, city: true, country: true, forwardedTeam: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Resolve the project: by id → existing name (case-insensitive) → create a
  // MANUAL, INACTIVE project (active:false keeps ad-hoc names out of the lead
  // auto-classifier / routing) so a brand-new free-text entry still saves.
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
    return NextResponse.json({ error: "That property belongs to another market and can't be added to this lead." }, { status: 403 });
  }

  // Manual add or re-add: suggestion=false (user explicitly chose this property).
  await prisma.leadInterestedProject.upsert({
    where: { leadId_projectId: { leadId: id, projectId: project.id } },
    create: { leadId: id, projectId: project.id, notes, interestedAt: new Date(), suggestion: false },
    update: { notes, interestedAt: new Date(), suggestion: false },
  });
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.PROJECT_DISCUSSED,
      status: ActivityStatus.DONE,
      title: `Interested: ${project.name}`,
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
  await prisma.leadInterestedProject.deleteMany({ where: { leadId: id, projectId } });
  return NextResponse.json({ ok: true });
}

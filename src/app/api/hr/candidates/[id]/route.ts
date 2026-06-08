import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const c = await prisma.hRCandidate.findUnique({
    where: { id },
    include: {
      primaryOwner:   { select: { id: true, name: true, avatarColor: true } },
      secondaryOwner: { select: { id: true, name: true, avatarColor: true } },
      activities:     { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      interviews:     { orderBy: { scheduledAt: "asc" }, include: { interviewer: { select: { name: true } } } },
      followUps:      { orderBy: { dueAt: "asc" }, include: { user: { select: { name: true } } } },
      resumes:        { orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ candidate: c });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.hRCandidate.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  const allowed = ["name","phone","altPhone","whatsappPhone","email","location","city","currentCompany",
    "currentProfile","positionApplied","experience","realEstateExperience","currentSalary","expectedSalary",
    "noticePeriod","source","status","remarks","tags","nextAction","nextActionDate","primaryOwnerId","secondaryOwnerId",
    "fitExperience","fitCommunication","fitStability","fitSalary","fitNotice","interviewFeedback","joiningProbability"];
  for (const key of allowed) {
    if (key in body) {
      if (key === "currentSalary" || key === "expectedSalary") {
        data[key] = body[key] ? parseFloat(body[key]) : null;
      } else if (key === "nextActionDate") {
        data[key] = body[key] ? new Date(body[key]) : null;
      } else {
        data[key] = body[key] || null;
      }
    }
  }

  const updated = await prisma.hRCandidate.update({ where: { id }, data });

  // Log status change
  if (body.status && body.status !== existing.status) {
    await prisma.hRActivity.create({
      data: {
        candidateId: id, userId: me.id,
        type: "STATUS_CHANGED",
        notes: body.statusNote || null,
        oldStatus: existing.status as HRCandidateStatus,
        newStatus: body.status as HRCandidateStatus,
      },
    });
  }

  return NextResponse.json({ candidate: updated });
}

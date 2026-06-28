import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";
import { loadOwnedCandidate, hrCan, hrRoleOf, hrNotFound } from "@/lib/hrAccess";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // RBAC: 404 if the caller can't see this candidate.
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;

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
  if (!c) return hrNotFound();
  return NextResponse.json({ candidate: c });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // RBAC: must be allowed to act on this candidate.
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  const existing = await prisma.hRCandidate.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return hrNotFound();

  // Ownership reassignment is gated on the `assign` permission — a Junior HR
  // editing their own candidate cannot move it to (or away from) themselves.
  const canAssign = hrCan(me, "assign");

  const data: Record<string, unknown> = {};
  const allowed = ["name","phone","altPhone","whatsappPhone","email","location","city","currentCompany",
    "currentProfile","positionApplied","experience","realEstateExperience","currentSalary","expectedSalary",
    "noticePeriod","source","status","remarks","tags","nextAction","nextActionDate","joiningDate","primaryOwnerId","secondaryOwnerId",
    "fitExperience","fitCommunication","fitStability","fitSalary","fitNotice","interviewFeedback","joiningProbability"];
  for (const key of allowed) {
    if (!(key in body)) continue;
    if ((key === "primaryOwnerId" || key === "secondaryOwnerId") && !canAssign) continue; // silently ignore reassignment by non-assigners
    if (key === "currentSalary" || key === "expectedSalary") {
      data[key] = body[key] ? parseFloat(body[key]) : null;
    } else if (key === "nextActionDate" || key === "joiningDate") {
      data[key] = body[key] ? new Date(body[key]) : null;
    } else {
      data[key] = body[key] || null;
    }
  }

  if (data.status === "OFFER_RELEASED" && hrRoleOf(me) === "JUNIOR_HR") {
    return NextResponse.json({ error: "Junior HR can't release offers — ask a Senior HR." }, { status: 403 });
  }

  // A manual status change overrides the imported original-status label so the
  // badge reflects the new choice (the timeline still records the change).
  if (body.status && body.status !== existing.status) data.originalStatus = null;

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

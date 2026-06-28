import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRInterviewType, HRCandidateStatus } from "@prisma/client";
import { loadOwnedCandidate } from "@/lib/hrAccess";

const STATUS_MAP: Record<HRInterviewType, HRCandidateStatus> = {
  VIRTUAL:      "VIRTUAL_INTERVIEW_SCHEDULED",
  HR:           "VIRTUAL_INTERVIEW_SCHEDULED",
  FINAL:        "F2F_INTERVIEW_SCHEDULED",
  FACE_TO_FACE: "F2F_INTERVIEW_SCHEDULED",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  if (!body.scheduledAt) return NextResponse.json({ error: "scheduledAt required" }, { status: 400 });
  if (!body.type) return NextResponse.json({ error: "type required" }, { status: 400 });

  const itype = body.type as HRInterviewType;
  const scheduledAt = new Date(body.scheduledAt);

  const [interview] = await prisma.$transaction(async (tx) => {
    const iv = await tx.hRInterview.create({
      data: {
        candidateId: id,
        type: itype,
        scheduledAt,
        interviewerId: body.interviewerId || me.id,
        notes: body.notes || null,
      },
    });

    // Update candidate status
    const newStatus = STATUS_MAP[itype];
    await tx.hRCandidate.update({ where: { id }, data: { status: newStatus } });

    // Log activity
    await tx.hRActivity.create({
      data: {
        candidateId: id, userId: me.id,
        type: "INTERVIEW_SCHEDULED",
        notes: `${itype.replace(/_/g, " ")} interview scheduled for ${scheduledAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
        newStatus,
      },
    });

    // Auto-create day-before confirmation follow-up
    const dayBefore = new Date(scheduledAt);
    dayBefore.setDate(dayBefore.getDate() - 1);
    dayBefore.setHours(10, 0, 0, 0);
    if (dayBefore > new Date()) {
      await tx.hRFollowUp.create({
        data: {
          candidateId: id, userId: me.id,
          type: "INTERVIEW_CONFIRMATION",
          dueAt: dayBefore,
          notes: `Confirm ${itype.replace(/_/g, " ")} interview for ${scheduledAt.toLocaleDateString("en-IN")}`,
          autoCreated: true,
        },
      });
    }

    // Auto-create morning-of reminder
    const morning = new Date(scheduledAt);
    morning.setHours(8, 0, 0, 0);
    if (morning > new Date()) {
      await tx.hRFollowUp.create({
        data: {
          candidateId: id, userId: me.id,
          type: "REMINDER",
          dueAt: morning,
          notes: `Interview day reminder — ${itype.replace(/_/g, " ")} at ${scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`,
          autoCreated: true,
        },
      });
    }

    return [iv];
  });

  return NextResponse.json({ interview }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  const iv = await prisma.hRInterview.update({
    where: { id: body.interviewId },
    data: {
      confirmationStatus: body.confirmationStatus ?? undefined,
      attendanceStatus:   body.attendanceStatus ?? undefined,
      result:             body.result ?? undefined,
      notes:              body.notes ?? undefined,
      noShowReason:       body.noShowReason ?? undefined,
    },
  });

  // Log attendance outcome
  if (body.attendanceStatus === "ATTENDED") {
    const newStatus: HRCandidateStatus = "INTERVIEW_HELD";
    await prisma.$transaction([
      prisma.hRCandidate.update({ where: { id: candidateId }, data: { status: newStatus } }),
      prisma.hRActivity.create({
        data: { candidateId, userId: me.id, type: "INTERVIEW_ATTENDED",
          notes: body.notes || `${iv.type.replace(/_/g, " ")} interview attended`, newStatus },
      }),
    ]);
  } else if (body.attendanceStatus === "NO_SHOW") {
    // Mark candidate No Show and auto-create a recovery follow-up for tomorrow morning.
    const recovery = new Date();
    recovery.setDate(recovery.getDate() + 1);
    recovery.setHours(10, 0, 0, 0);
    await prisma.$transaction([
      prisma.hRCandidate.update({
        where: { id: candidateId },
        data: { status: "NO_SHOW", nextAction: "No-show recovery call", nextActionDate: recovery },
      }),
      prisma.hRActivity.create({
        data: { candidateId, userId: me.id, type: "INTERVIEW_NO_SHOW",
          notes: `No-show: ${body.noShowReason ?? "reason unknown"}` },
      }),
      prisma.hRFollowUp.create({
        data: { candidateId, userId: me.id, type: "NO_SHOW_RECOVERY", dueAt: recovery,
          notes: "Candidate did not attend — recovery call", autoCreated: true },
      }),
      prisma.hRActivity.create({
        data: { candidateId, userId: me.id, type: "FOLLOWUP_CREATED",
          notes: "No-show recovery follow-up auto-created for tomorrow" },
      }),
    ]);
  }

  return NextResponse.json({ interview: iv });
}

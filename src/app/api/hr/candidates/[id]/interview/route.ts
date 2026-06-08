import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRInterviewType, HRCandidateStatus } from "@prisma/client";

const STATUS_MAP: Record<HRInterviewType, HRCandidateStatus> = {
  VIRTUAL:      "VIRTUAL_INTERVIEW_SCHEDULED",
  HR:           "VIRTUAL_INTERVIEW_SCHEDULED",
  FINAL:        "FINAL_INTERVIEW_SCHEDULED",
  FACE_TO_FACE: "FINAL_INTERVIEW_SCHEDULED",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
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
  const me = await requireUser();
  const { id: candidateId } = await params;
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
    const typeMap: Record<HRInterviewType, HRCandidateStatus> = {
      VIRTUAL:      "HR_INTERVIEW_COMPLETED",
      HR:           "HR_INTERVIEW_COMPLETED",
      FINAL:        "FINAL_INTERVIEW_COMPLETED",
      FACE_TO_FACE: "FINAL_INTERVIEW_COMPLETED",
    };
    const newStatus = typeMap[iv.type] ?? "PIPELINE";
    await prisma.$transaction([
      prisma.hRCandidate.update({ where: { id: candidateId }, data: { status: newStatus } }),
      prisma.hRActivity.create({
        data: { candidateId, userId: me.id, type: "INTERVIEW_ATTENDED",
          notes: body.notes || `${iv.type.replace(/_/g, " ")} interview attended`, newStatus },
      }),
    ]);
  } else if (body.attendanceStatus === "NO_SHOW") {
    await prisma.hRActivity.create({
      data: { candidateId, userId: me.id, type: "INTERVIEW_NO_SHOW",
        notes: `No-show: ${body.noShowReason ?? "reason unknown"}` },
    });
  }

  return NextResponse.json({ interview: iv });
}

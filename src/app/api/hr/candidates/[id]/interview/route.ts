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

// recommendation → candidate status mapping (post-interview outcome).
// SELECTED → SHORTLISTED (next step toward offer), REJECTED → REJECTED, HOLD → HOLD.
const RECOMMENDATION_STATUS: Record<string, HRCandidateStatus> = {
  SELECTED: "SHORTLISTED",
  REJECTED: "REJECTED",
  HOLD:     "HOLD",
};

const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

// ── Interview CONFLICT detection (NON-blocking warning) ──────────────────────
// Does `interviewerId` already have another interview within ±60 min of `at`?
// Returns a small descriptor for the UI to warn on, or null. NEVER blocks
// scheduling — purely advisory. `excludeInterviewId` skips the row being
// rescheduled so an interview never conflicts with itself.
const CONFLICT_WINDOW_MIN = 60;
type InterviewConflict = { message: string; interviewerName: string; otherCandidateName: string; scheduledAt: Date };

async function detectInterviewConflict(
  interviewerId: string | null | undefined,
  at: Date,
  excludeInterviewId?: string,
): Promise<InterviewConflict | null> {
  if (!interviewerId) return null; // unassigned interviewer → nothing to clash with
  const windowMs = CONFLICT_WINDOW_MIN * 60_000;
  const from = new Date(at.getTime() - windowMs);
  const to = new Date(at.getTime() + windowMs);

  const clash = await prisma.hRInterview.findFirst({
    where: {
      interviewerId,
      scheduledAt: { gte: from, lte: to },
      ...(excludeInterviewId ? { id: { not: excludeInterviewId } } : {}),
      // Ignore interviews already marked done/cancelled — only live slots clash.
      attendanceStatus: { in: ["SCHEDULED", "RESCHEDULED"] },
      candidate: { deletedAt: null },
    },
    orderBy: { scheduledAt: "asc" },
    select: {
      scheduledAt: true,
      interviewer: { select: { name: true } },
      candidate: { select: { name: true } },
    },
  });
  if (!clash) return null;
  const interviewerName = clash.interviewer?.name ?? "Interviewer";
  const otherCandidateName = clash.candidate?.name ?? "another candidate";
  const whenStr = clash.scheduledAt.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
  return {
    message: `${interviewerName} already has an interview with ${otherCandidateName} at ${whenStr} (within ${CONFLICT_WINDOW_MIN} min).`,
    interviewerName,
    otherCandidateName,
    scheduledAt: clash.scheduledAt,
  };
}

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
  const interviewerId = body.interviewerId || me.id;

  // Advisory conflict check BEFORE creating (does not block).
  const conflict = await detectInterviewConflict(interviewerId, scheduledAt);

  const [interview] = await prisma.$transaction(async (tx) => {
    const iv = await tx.hRInterview.create({
      data: {
        candidateId: id,
        type: itype,
        scheduledAt,
        interviewerId,
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
        notes: `${itype.replace(/_/g, " ")} interview scheduled for ${fmtDateTime(scheduledAt)}`,
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
          notes: `Confirm ${itype.replace(/_/g, " ")} interview for ${scheduledAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
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
          notes: `Interview day reminder — ${itype.replace(/_/g, " ")} at ${scheduledAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`,
          autoCreated: true,
        },
      });
    }

    return [iv];
  });

  return NextResponse.json({ interview, conflict: conflict ?? null }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  if (!body.interviewId) return NextResponse.json({ error: "interviewId required" }, { status: 400 });

  // Ensure the interview belongs to this candidate (defence-in-depth: never let an
  // owned-candidate request touch another candidate's interview row).
  const existing = await prisma.hRInterview.findUnique({ where: { id: body.interviewId } });
  if (!existing || existing.candidateId !== candidateId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── RESCHEDULE ──────────────────────────────────────────────────────────────
  // Backward-compatible: a reschedule updates the EXISTING interview's scheduledAt
  // (previously a "reschedule" wrongly POSTed a brand-new interview row).
  if (body.action === "reschedule" || (body.scheduledAt && body.action !== "result")) {
    if (!body.scheduledAt) return NextResponse.json({ error: "scheduledAt required" }, { status: 400 });
    const newAt = new Date(body.scheduledAt);
    const oldAt = existing.scheduledAt;
    const itype = existing.type;
    const newStatus = STATUS_MAP[itype];

    // Advisory conflict check against the effective interviewer at the NEW time,
    // excluding this interview row so it can't clash with itself. Non-blocking.
    const conflict = await detectInterviewConflict(existing.interviewerId, newAt, existing.id);

    const iv = await prisma.$transaction(async (tx) => {
      const updated = await tx.hRInterview.update({
        where: { id: body.interviewId },
        data: {
          scheduledAt: newAt,
          confirmationStatus: "PENDING",
          attendanceStatus: "SCHEDULED",
          notes: body.notes ?? undefined,
        },
      });

      // Reset candidate status back to "scheduled" for this interview type.
      await tx.hRCandidate.update({ where: { id: candidateId }, data: { status: newStatus } });

      await tx.hRActivity.create({
        data: {
          candidateId, userId: me.id,
          type: "INTERVIEW_RESCHEDULED",
          notes: `${itype.replace(/_/g, " ")} interview rescheduled from ${fmtDateTime(oldAt)} to ${fmtDateTime(newAt)}`,
          newStatus,
        },
      });

      // Clear the now-stale auto-created CONFIRMATION/REMINDER follow-ups, then
      // recreate them aligned to the new date.
      await tx.hRFollowUp.deleteMany({
        where: {
          candidateId,
          autoCreated: true,
          completedAt: null,
          type: { in: ["INTERVIEW_CONFIRMATION", "REMINDER"] },
        },
      });

      const dayBefore = new Date(newAt);
      dayBefore.setDate(dayBefore.getDate() - 1);
      dayBefore.setHours(10, 0, 0, 0);
      if (dayBefore > new Date()) {
        await tx.hRFollowUp.create({
          data: {
            candidateId, userId: me.id, type: "INTERVIEW_CONFIRMATION", dueAt: dayBefore,
            notes: `Confirm ${itype.replace(/_/g, " ")} interview for ${newAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
            autoCreated: true,
          },
        });
      }
      const morning = new Date(newAt);
      morning.setHours(8, 0, 0, 0);
      if (morning > new Date()) {
        await tx.hRFollowUp.create({
          data: {
            candidateId, userId: me.id, type: "REMINDER", dueAt: morning,
            notes: `Interview day reminder — ${itype.replace(/_/g, " ")} at ${newAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`,
            autoCreated: true,
          },
        });
      }

      return updated;
    });

    return NextResponse.json({ interview: iv, conflict: conflict ?? null });
  }

  // ── RESULT / FEEDBACK capture ───────────────────────────────────────────────
  // recommendation ∈ SELECTED|REJECTED|HOLD → drives candidate status.
  if (body.action === "result" || body.recommendation) {
    const recommendation = body.recommendation ? String(body.recommendation).toUpperCase() : null;
    if (recommendation && !RECOMMENDATION_STATUS[recommendation])
      return NextResponse.json({ error: "recommendation must be SELECTED, REJECTED or HOLD" }, { status: 400 });

    const iv = await prisma.$transaction(async (tx) => {
      const updated = await tx.hRInterview.update({
        where: { id: body.interviewId },
        data: {
          result:         body.result ?? undefined,
          recommendation: recommendation ?? undefined,
          notes:          body.notes ?? undefined,
          // Recording a result means the interview was held.
          attendanceStatus: existing.attendanceStatus === "SCHEDULED" || existing.attendanceStatus === "RESCHEDULED"
            ? "ATTENDED" : undefined,
        },
      });

      const newStatus = recommendation ? RECOMMENDATION_STATUS[recommendation] : "INTERVIEW_HELD";
      await tx.hRCandidate.update({
        where: { id: candidateId },
        data: {
          status: newStatus,
          ...(body.result || body.notes ? { interviewFeedback: body.notes || body.result } : {}),
        },
      });

      const recLabel = recommendation ? ` — ${recommendation}` : "";
      await tx.hRActivity.create({
        data: {
          candidateId, userId: me.id,
          type: "INTERVIEW_ATTENDED",
          notes: `${existing.type.replace(/_/g, " ")} interview result recorded${recLabel}${body.result ? ` (${body.result})` : ""}${body.notes ? `: ${body.notes}` : ""}`,
          newStatus,
        },
      });

      return updated;
    });

    return NextResponse.json({ interview: iv });
  }

  // ── Legacy attendance / confirmation update (unchanged behaviour) ────────────
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

// ── DELETE an interview ───────────────────────────────────────────────────────
// Removing an interview also clears its auto-created (open) CONFIRMATION / REMINDER
// follow-ups so the candidate's queue isn't left with orphaned reminders.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const { me } = access;

  const { searchParams } = new URL(req.url);
  let interviewId = searchParams.get("interviewId");
  if (!interviewId) {
    try { interviewId = (await req.json())?.interviewId ?? null; } catch { /* no body */ }
  }
  if (!interviewId) return NextResponse.json({ error: "interviewId required" }, { status: 400 });

  const existing = await prisma.hRInterview.findUnique({ where: { id: interviewId } });
  if (!existing || existing.candidateId !== candidateId)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.$transaction([
    // Clear the open auto-created confirmation/reminder follow-ups tied to interviews.
    prisma.hRFollowUp.deleteMany({
      where: {
        candidateId,
        autoCreated: true,
        completedAt: null,
        type: { in: ["INTERVIEW_CONFIRMATION", "REMINDER"] },
      },
    }),
    prisma.hRInterview.delete({ where: { id: interviewId } }),
    prisma.hRActivity.create({
      data: {
        candidateId, userId: me.id, type: "NOTE_ADDED",
        notes: `${existing.type.replace(/_/g, " ")} interview (${fmtDateTime(existing.scheduledAt)}) deleted; auto-created confirmation/reminder follow-ups cleared`,
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}

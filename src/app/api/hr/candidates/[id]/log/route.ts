import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRActivityType, HRCandidateStatus } from "@prisma/client";
import { loadOwnedCandidate } from "@/lib/hrAccess";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  const type = body.type as HRActivityType;
  if (!type) return NextResponse.json({ error: "type required" }, { status: 400 });

  const existing = await prisma.hRCandidate.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Auto-update candidate status based on activity outcome ──────────
  // Two kinds of mapping:
  //   • UNCONDITIONAL — explicit milestones that should always move the
  //     candidate forward (offer/join). These mirror an intentional action.
  //   • EARLY-STAGE-ONLY — call outcomes (no-answer, busy, switched-off,
  //     wrong-number, call-later, connected) that should classify a candidate
  //     who is still untouched/early, but must NEVER overwrite a more-advanced
  //     pipeline status (e.g. a SHORTLISTED candidate who didn't pick up today
  //     stays SHORTLISTED, not NOT_RESPONDING).
  const unconditionalMap: Partial<Record<HRActivityType, HRCandidateStatus>> = {
    OFFER_RELEASED:    "OFFER_RELEASED",
    OFFER_DECLINED:    "OFFER_DECLINED",
    CANDIDATE_JOINED:  "JOINED",
  };
  // Outcomes that only classify candidates still in an early/neutral state.
  const earlyStageMap: Partial<Record<HRActivityType, HRCandidateStatus>> = {
    CALL_CONNECTED:     "INTERESTED",     // reached & talking → INTERESTED (early only)
    CALL_NOT_ANSWERED:  "NOT_RESPONDING",
    CALL_BUSY:          "NOT_RESPONDING",
    CALL_SWITCHED_OFF:  "SWITCH_OFF",
    CALL_WRONG_NUMBER:  "WRONG_NUMBER",
    CALL_LATER:         "HOLD",
  };
  // Statuses considered "early/neutral" — safe for a call outcome to overwrite.
  const EARLY_STATUSES = new Set<HRCandidateStatus>([
    "NEW",
    "NOT_CALLED",
    "NOT_RESPONDING",
    "SWITCH_OFF",
    "HOLD",
    "INTERESTED",
  ]);

  let autoStatus: HRCandidateStatus | undefined;
  if (body.newStatus) {
    // An explicit caller-supplied status always wins (existing behaviour).
    autoStatus = body.newStatus as HRCandidateStatus;
  } else if (unconditionalMap[type]) {
    autoStatus = unconditionalMap[type];
  } else if (earlyStageMap[type] && EARLY_STATUSES.has(existing.status as HRCandidateStatus)) {
    // Call outcome → only when the candidate hasn't progressed past early stage.
    autoStatus = earlyStageMap[type];
  }

  const updates: Record<string, unknown> = {};
  if (autoStatus && autoStatus !== existing.status) updates.status = autoStatus;
  if (body.nextAction)     updates.nextAction = body.nextAction;
  if (body.nextActionDate) updates.nextActionDate = new Date(body.nextActionDate);

  const [activity] = await prisma.$transaction([
    prisma.hRActivity.create({
      data: {
        candidateId: id,
        userId: me.id,
        type,
        notes: body.notes || null,
        oldStatus: existing.status as HRCandidateStatus,
        newStatus: (autoStatus ?? existing.status) as HRCandidateStatus,
      },
    }),
    ...(Object.keys(updates).length > 0
      ? [prisma.hRCandidate.update({ where: { id }, data: updates })]
      : []),
  ]);

  return NextResponse.json({ activity }, { status: 201 });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRFollowUpType } from "@prisma/client";
import { loadOwnedCandidate } from "@/lib/hrAccess";

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtType(t: string) {
  return t.replace(/_/g, " ");
}

/** Recompute the soonest pending follow-up and sync candidate.nextActionDate. */
async function syncNextAction(candidateId: string) {
  const next = await prisma.hRFollowUp.findFirst({
    where: { candidateId, completedAt: null },
    orderBy: { dueAt: "asc" },
    select: { dueAt: true, type: true, notes: true },
  });
  if (next) {
    await prisma.hRCandidate.update({
      where: { id: candidateId },
      data: {
        nextAction: next.notes || fmtType(next.type),
        nextActionDate: next.dueAt,
      },
    });
  } else {
    await prisma.hRCandidate.update({
      where: { id: candidateId },
      data: { nextAction: null, nextActionDate: null },
    });
  }
}

// ── Create a follow-up ───────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  if (!body.dueAt) return NextResponse.json({ error: "dueAt required" }, { status: 400 });

  const due = new Date(body.dueAt);
  if (isNaN(due.getTime())) return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
  // New follow-ups must not be scheduled in the past (small grace for clock skew).
  if (due.getTime() < Date.now() - 60_000) {
    return NextResponse.json({ error: "Follow-up date cannot be in the past" }, { status: 400 });
  }

  const followUp = await prisma.hRFollowUp.create({
    data: {
      candidateId: id,
      userId: me.id,
      type: (body.type as HRFollowUpType) ?? "CALL_BACK",
      dueAt: due,
      notes: body.notes || null,
      autoCreated: body.autoCreated ?? false,
    },
  });

  // Keep candidate.nextActionDate pointing at the soonest pending follow-up.
  const candidate = await prisma.hRCandidate.findUnique({ where: { id }, select: { nextActionDate: true } });
  if (!candidate?.nextActionDate || due < candidate.nextActionDate) {
    await prisma.hRCandidate.update({
      where: { id },
      data: { nextAction: body.notes || fmtType(followUp.type), nextActionDate: due },
    });
  }

  await prisma.hRActivity.create({
    data: {
      candidateId: id, userId: me.id,
      type: "FOLLOWUP_CREATED",
      notes: `Follow-up set: ${fmtType(followUp.type)} on ${due.toLocaleDateString("en-IN")}`,
    },
  });

  return NextResponse.json({ followUp }, { status: 201 });
}

// ── Act on a follow-up: complete (+chain next) / snooze / skip ───────────────
// Backward-compatible: existing callers send only { followUpId } (+optional notes)
// and get the same "complete" behaviour as before.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();
  const followUpId: string = body.followUpId;
  const action: "complete" | "snooze" | "skip" = body.action ?? "complete";

  if (!followUpId) return NextResponse.json({ error: "followUpId required" }, { status: 400 });

  // Ensure the follow-up belongs to this candidate (scope already enforced above).
  const existing = await prisma.hRFollowUp.findUnique({
    where: { id: followUpId },
    select: { id: true, candidateId: true, type: true, dueAt: true, notes: true },
  });
  if (!existing || existing.candidateId !== candidateId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── SNOOZE: push the due date out, keep the follow-up open ──────────────────
  if (action === "snooze") {
    if (!body.dueAt) return NextResponse.json({ error: "dueAt required to snooze" }, { status: 400 });
    const newDue = new Date(body.dueAt);
    if (isNaN(newDue.getTime())) return NextResponse.json({ error: "Invalid dueAt" }, { status: 400 });
    if (newDue.getTime() < Date.now() - 60_000) {
      return NextResponse.json({ error: "Snooze date cannot be in the past" }, { status: 400 });
    }

    const fu = await prisma.hRFollowUp.update({
      where: { id: followUpId },
      data: { dueAt: newDue, notes: body.notes ? body.notes : undefined },
    });

    // Log as a NOTE (not FOLLOWUP_CREATED) — a snooze isn't a new follow-up, and
    // the timeline renders FOLLOWUP_CREATED as "Follow-up Set", which misrepresents
    // a snooze. Behaviour (push due date, keep open) is unchanged.
    const snoozeWhen = `${newDue.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} ${newDue.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}`;
    await prisma.hRActivity.create({
      data: {
        candidateId, userId: me.id,
        type: "NOTE_ADDED",
        notes: `Follow-up snoozed to ${snoozeWhen}`,
      },
    });

    await syncNextAction(candidateId);
    return NextResponse.json({ followUp: fu });
  }

  // ── SKIP: mark complete with a 'skipped' note (no work done) ────────────────
  if (action === "skip") {
    const skipNote = body.notes ? `Skipped: ${body.notes}` : "Skipped";
    const fu = await prisma.hRFollowUp.update({
      where: { id: followUpId },
      data: { completedAt: new Date(), notes: skipNote },
    });

    await prisma.hRActivity.create({
      data: {
        candidateId, userId: me.id,
        type: "FOLLOWUP_COMPLETED",
        notes: `Follow-up skipped: ${fmtType(fu.type)}${body.notes ? ` — ${body.notes}` : ""}`,
      },
    });

    await maybeChainNext(candidateId, me.id, body);
    await syncNextAction(candidateId);
    return NextResponse.json({ followUp: fu });
  }

  // ── COMPLETE (default) ──────────────────────────────────────────────────────
  const fu = await prisma.hRFollowUp.update({
    where: { id: followUpId },
    data: { completedAt: new Date(), notes: body.notes ? body.notes : undefined },
  });

  await prisma.hRActivity.create({
    data: {
      candidateId, userId: me.id,
      type: "FOLLOWUP_COMPLETED",
      notes: body.notes || `Follow-up completed: ${fmtType(fu.type)}`,
    },
  });

  const chained = await maybeChainNext(candidateId, me.id, body);
  await syncNextAction(candidateId);

  return NextResponse.json({ followUp: fu, nextFollowUp: chained });
}

/**
 * If the caller supplied body.nextDueAt, create the next follow-up so the
 * candidate never falls off the board. Returns the created follow-up (or null).
 */
async function maybeChainNext(
  candidateId: string,
  userId: string,
  body: { nextDueAt?: string; nextType?: string; nextNotes?: string },
) {
  if (!body.nextDueAt) return null;
  const due = new Date(body.nextDueAt);
  if (isNaN(due.getTime())) return null;
  // Silently ignore a past next-date rather than blocking the completion.
  if (due.getTime() < Date.now() - 60_000) return null;

  const nextType = (body.nextType as HRFollowUpType) ?? "CALL_BACK";
  const next = await prisma.hRFollowUp.create({
    data: {
      candidateId,
      userId,
      type: nextType,
      dueAt: due,
      notes: body.nextNotes || null,
      autoCreated: true,
    },
  });

  await prisma.hRActivity.create({
    data: {
      candidateId, userId,
      type: "FOLLOWUP_CREATED",
      notes: `Next follow-up set: ${fmtType(next.type)} on ${due.toLocaleDateString("en-IN")}`,
    },
  });

  return next;
}

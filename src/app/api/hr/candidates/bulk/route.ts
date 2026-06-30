import { NextResponse, type NextRequest } from "next/server";
import { requireHrPermission, hrActiveScopeWhere, hrCan, hrRoleOf } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";

// Bulk actions from the Candidates list: change status, reassign owner, and/or
// set a follow-up date (creates a call-back task + next action for each
// selected candidate — the fast way to put fresh imports into the work queue).
export async function POST(req: NextRequest) {
  // Bulk actions are privileged — Junior HR is blocked entirely.
  const auth = await requireHrPermission("bulkActions");
  if (auth.error) return auth.error;
  const { me } = auth;

  const body = await req.json();
  const requestedIds: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (requestedIds.length === 0) return NextResponse.json({ error: "No candidates selected" }, { status: 400 });

  // CRITICAL: restrict the operation to candidates IN SCOPE. Intersect the
  // requested id list with ids matching hrScopeWhere(me) so a user can never act
  // on candidates outside their scope. (Admin/Senior HR scope is {} → all pass.)
  const inScope = await prisma.hRCandidate.findMany({
    where: { AND: [hrActiveScopeWhere(me), { id: { in: requestedIds } }] },
    select: { id: true },
  });
  const ids = inScope.map(c => c.id);
  if (ids.length === 0) return NextResponse.json({ error: "No candidates in your scope were selected" }, { status: 403 });

  // Validate the requested action against the known set so an unrecognised
  // action can't slip through to the update path and return a misleading
  // {updated:0} success. Status/owner/follow-up updates carry NO `action`
  // field (only `delete` is an explicit action), so anything else is invalid.
  const KNOWN_ACTIONS = ["delete"];
  if (body.action != null && !KNOWN_ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: `Unknown bulk action: ${body.action}` }, { status: 400 });
  }

  // Bulk delete — requires the deleteCandidate permission. SOFT-deletes the
  // candidates (recycle bin) by stamping deletedAt; never hard-deletes, so the
  // rows + their workflow history can be recovered.
  if (body.action === "delete") {
    if (!hrCan(me, "deleteCandidate")) return NextResponse.json({ error: "You don't have permission to delete candidates." }, { status: 403 });
    const del = await prisma.hRCandidate.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    return NextResponse.json({ ok: true, deleted: del.count });
  }

  const data: { status?: HRCandidateStatus; primaryOwnerId?: string } = {};
  if (body.status) data.status = body.status as HRCandidateStatus;
  if (body.primaryOwnerId) {
    // Owner reassignment requires the assign permission.
    if (!hrCan(me, "assign")) return NextResponse.json({ error: "You don't have permission to reassign candidate ownership." }, { status: 403 });
    // Target must be an ACTIVE HR user — never orphan a candidate onto a Sales/inactive user.
    const validOwner = await prisma.user.findFirst({
      where: { id: body.primaryOwnerId, active: true, OR: [{ hrOnly: true }, { hrTeam: true }, { role: "ADMIN" }] },
      select: { id: true },
    });
    if (!validOwner) return NextResponse.json({ error: "Invalid owner — must be an active HR team member." }, { status: 400 });
    data.primaryOwnerId = body.primaryOwnerId;
  }
  if (data.status === "OFFER_RELEASED" && hrRoleOf(me) === "JUNIOR_HR") {
    return NextResponse.json({ error: "Interns can't release offers — ask a manager." }, { status: 403 });
  }

  const followUpDate = typeof body.followUpDate === "string" && body.followUpDate ? new Date(body.followUpDate) : null;
  const validFollowUp = followUpDate && !isNaN(followUpDate.getTime());
  const followUpNote = typeof body.followUpNote === "string" ? body.followUpNote.trim() : "";

  if (Object.keys(data).length === 0 && !validFollowUp) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // 1. Status / owner update (+ timeline).
  if (Object.keys(data).length > 0) {
    await prisma.hRCandidate.updateMany({ where: { id: { in: ids } }, data });
    const note = data.status ? `Bulk update: status → ${data.status.replace(/_/g, " ")}` : "Bulk update: owner reassigned";
    await prisma.hRActivity.createMany({
      data: ids.map(id => ({
        candidateId: id, userId: me.id,
        type: data.status ? ("STATUS_CHANGED" as const) : ("NOTE_ADDED" as const),
        notes: note, newStatus: data.status ?? null,
      })),
    });
  }

  // 2. Bulk follow-up: a call-back task + next action for each candidate.
  if (validFollowUp) {
    const due = followUpDate as Date;
    const noteText = followUpNote || "Follow up with candidate";
    await prisma.hRFollowUp.createMany({ data: ids.map(id => ({ candidateId: id, dueAt: due, type: "CALL_BACK" as const, userId: me.id, notes: noteText })) });
    await prisma.hRCandidate.updateMany({ where: { id: { in: ids } }, data: { nextActionDate: due, nextAction: noteText } });
    const label = due.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    await prisma.hRActivity.createMany({ data: ids.map(id => ({ candidateId: id, userId: me.id, type: "FOLLOWUP_CREATED" as const, notes: `Bulk follow-up set for ${label}` })) });
  }

  return NextResponse.json({ ok: true, updated: ids.length });
}

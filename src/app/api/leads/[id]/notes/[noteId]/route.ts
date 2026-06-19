import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { audit, reqMeta } from "@/lib/audit";

/**
 * DELETE /api/leads/[id]/notes/[noteId]
 *
 * Removes a note. Caller must be the note's author OR an ADMIN. Always
 * verifies the note actually belongs to the lead in the URL (defence in
 * depth — prevents cross-lead deletes via a guessed noteId).
 *
 * Note.pinned does not exist in the schema, so PATCH/pin is not implemented.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, leadId: true, userId: true, body: true, createdAt: true },
  });
  if (!note || note.leadId !== id) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  // Only the author or an admin can delete — managers seeing a report's lead
  // can still view but not nuke another agent's notes.
  if (me.role !== "ADMIN" && note.userId !== me.id) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  // Preserve the note's full content in the audit trail BEFORE physical removal,
  // so a deleted remark stays recoverable (remarks must never be silently lost).
  await audit({
    userId: me.id,
    action: "note.delete",
    entity: "Note",
    entityId: noteId,
    meta: { leadId: id, authorId: note.userId, body: note.body, createdAt: note.createdAt.toISOString() },
    request: reqMeta(req),
  }).catch(() => {});

  await prisma.note.delete({ where: { id: noteId } });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/leads/[id]/notes/[noteId]   body: { content: string }
 *
 * Edit a remark. ADMIN / Super-Admin may edit ANY remark (incl. historical);
 * an agent may edit only their OWN remark and only on the SAME DAY (IST). The
 * old→new value is written to the audit trail AND LeadFieldHistory, so the
 * historical record is always preserved.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const { id, noteId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const reqBody = await req.json().catch(() => ({}));
  const newBody = String(reqBody.content ?? reqBody.body ?? "").trim();
  if (!newBody) return NextResponse.json({ error: "Remark cannot be empty" }, { status: 400 });

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { id: true, leadId: true, userId: true, body: true, createdAt: true },
  });
  if (!note || note.leadId !== id) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  // EDIT rights are Lalit-ONLY (Raw History / Smart Timeline / notes edit lock —
  // owner decision 2026-06-19). Agents, managers, OTHER admins, and HR can ADD new
  // notes/activities but may NOT edit an existing remark/note. me.canControlConversations
  // is the Lalit flag (same gate as conversation moderation).
  if (!me.canControlConversations) {
    return NextResponse.json({ error: "Only Lalit can edit existing remarks/notes. You can add a new note instead." }, { status: 403 });
  }
  if (note.body === newBody) return NextResponse.json({ ok: true, unchanged: true });

  await audit({
    userId: me.id,
    action: "note.edit",
    entity: "Note",
    entityId: noteId,
    meta: { leadId: id, authorId: note.userId, oldBody: note.body, newBody, createdAt: note.createdAt.toISOString() },
    request: reqMeta(req),
  }).catch(() => {});
  await prisma.leadFieldHistory.create({
    data: { leadId: id, field: "remarks", oldValue: note.body, newValue: newBody, changedById: me.id, source: "note-edit" },
  }).catch(() => {});
  // Conversation audit row — drives the "Edited by Lalit" badge + keeps the
  // original note body recoverable in the same audit trail as raw-remark edits.
  await prisma.remarkAuditLog.create({
    data: {
      leadId: id, remarkKey: noteId, action: "EDIT_NOTE",
      actorId: me.id, actorName: me.name,
      oldState: note.body, newState: newBody, reason: null,
    },
  }).catch(() => {});

  await prisma.note.update({ where: { id: noteId }, data: { body: newBody } });
  return NextResponse.json({ ok: true });
}

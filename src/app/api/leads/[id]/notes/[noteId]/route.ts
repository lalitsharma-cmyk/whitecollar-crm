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

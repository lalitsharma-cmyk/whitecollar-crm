import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { ActivityType, ActivityStatus } from "@prisma/client";

/**
 * GET /api/leads/[id]/interest-notes
 * Returns all LeadInterestNote rows for the lead, oldest first.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const notes = await prisma.leadInterestNote.findMany({
    where: { leadId: id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(notes);
}

/**
 * POST /api/leads/[id]/interest-notes
 * Creates a new manual interest note for the lead.
 *
 * Body: { noteText: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const body = await req.json().catch(() => ({}));
  const noteText = String(body.noteText ?? "").trim();

  if (!noteText) {
    return NextResponse.json(
      { error: "noteText is required" },
      { status: 400 }
    );
  }
  if (noteText.length > 500) {
    return NextResponse.json(
      { error: "noteText must be 500 characters or fewer" },
      { status: 400 }
    );
  }

  const note = await prisma.leadInterestNote.create({
    data: {
      leadId: id,
      noteText,
      autoDetected: false,
      sourceType: "MANUAL",
    },
  });
  // Log to activity history (owner spec) + bump lastTouchedAt.
  await prisma.activity.create({
    data: {
      leadId: id, userId: scoped.me.id,
      type: ActivityType.NOTE, status: ActivityStatus.DONE,
      title: `Interested property added: ${noteText.slice(0, 80)}`,
      completedAt: new Date(),
    },
  }).catch(() => {});
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});

  return NextResponse.json({ ok: true, note });
}

/**
 * DELETE /api/leads/[id]/interest-notes
 * Removes a specific interest note by its id.
 *
 * Body: { id: string }  — the note id, not the lead id
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: leadId } = await params;

  const scoped = await loadOwnedLead(leadId);
  if (scoped.error) return scoped.error;

  const body = await req.json().catch(() => ({}));
  const noteId = String(body.id ?? "").trim();

  if (!noteId) {
    return NextResponse.json(
      { error: "note id is required" },
      { status: 400 }
    );
  }

  const note = await prisma.leadInterestNote.findUnique({
    where: { id: noteId },
  });

  if (!note) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
  }

  if (note.leadId !== leadId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.leadInterestNote.delete({ where: { id: noteId } });

  return NextResponse.json({ ok: true });
}

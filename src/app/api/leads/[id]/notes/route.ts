import { NextResponse, type NextRequest } from "next/server";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * POST /api/leads/[id]/notes
 *
 * Creates a free-text note attached to a lead. Used by the Notes card on the
 * lead detail page. Scope-checked via loadOwnedLead — agents can only add
 * notes to their own leads.
 *
 * Body: { content: string }   (mapped to Note.body in the schema)
 * Returns the new note hydrated with the author so the UI can render it
 * without a refetch.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const body = await req.json().catch(() => ({}));
  const content = String(body.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "Note cannot be empty" }, { status: 400 });
  }
  if (content.length > 5000) {
    return NextResponse.json({ error: "Note is too long (max 5000 chars)" }, { status: 400 });
  }

  const note = await prisma.note.create({
    data: { leadId: id, userId: me.id, body: content },
    include: { user: { select: { name: true, avatarColor: true } } },
  });

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: "📝 Note added",
      description: content.length > 200 ? content.slice(0, 200) + "…" : content,
    },
  }).catch(() => {}); // non-fatal — note already saved

  // Bump lastTouchedAt so the lead doesn't immediately flag as "stale" after
  // an agent adds notes — same pattern other lead-touching endpoints use.
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});

  return NextResponse.json({
    ok: true,
    note: {
      id: note.id,
      content: note.body,
      createdAt: note.createdAt.toISOString(),
      user: note.user ? { name: note.user.name, avatarColor: note.user.avatarColor } : null,
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { ActivityType, ActivityStatus, NotifKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { notify } from "@/lib/notify";

/**
 * POST /api/leads/[id]/note
 *
 * Quick-note endpoint used by the QuickNoteCard widget on the lead detail page.
 * Auth: any logged-in user (getCurrentUser).
 *
 * Body: { text: string }
 * Returns: { ok: true, note: { id, body, createdAt } }
 *
 * Uses the Note model — CallLog requires non-nullable phoneNumber + outcome
 * fields that don't apply to a plain text note.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const text = String(body.text ?? "").trim();

  if (!text) {
    return NextResponse.json({ error: "Note text cannot be empty" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Note is too long (max 2000 chars)" }, { status: 400 });
  }

  // Verify the lead exists
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, ownerId: true, name: true } });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const note = await prisma.note.create({
    data: { leadId: id, userId: me.id, body: text },
  });

  // Log an activity so the note appears in the Timeline
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: "📝 Quick note added",
      description: text.length > 200 ? text.slice(0, 200) + "…" : text,
      completedAt: new Date(),
    },
  }).catch(() => {}); // non-fatal

  // Notification trigger — "Lead Comment Added": ping the lead OWNER (in-app +
  // web push) when someone else adds a note, so they don't miss team context.
  if (lead.ownerId && lead.ownerId !== me.id) {
    notify({
      userId: lead.ownerId,
      kind: NotifKind.SYSTEM,
      severity: "INFO",
      title: `💬 New note on ${lead.name}`,
      body: text.length > 120 ? text.slice(0, 120) + "…" : text,
      linkUrl: `/leads/${id}`,
      leadId: id,
    }).catch(() => {});
  }

  // Bump lastTouchedAt
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});

  return NextResponse.json({
    ok: true,
    note: {
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * PATCH /api/leads/[id]/log-note
 *
 * Edit the NOTE of a logged interaction — Call, WhatsApp, Site Visit or Meeting.
 * The note lives in a different table per kind:
 *   kind="call"     → CallLog.notes
 *   kind="whatsapp" → WhatsAppMessage.body
 *   kind="activity" → Activity.description   (SITE_VISIT / *_MEETING / EXPO / HOME)
 *
 * SAME-DAY RULE (per Lalit): an AGENT may edit only an entry THEY logged, and
 * only on the IST calendar day it was logged — it locks at IST midnight ("after
 * night 12, not editable"). Admin/Manager may edit anytime. Only the note text
 * changes — never the outcome, time, direction, or who logged it.
 */

const EDITABLE_ACTIVITY = new Set<ActivityType>([
  ActivityType.SITE_VISIT, ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING,
  ActivityType.MEETING, ActivityType.EXPO_MEETING, ActivityType.HOME_VISIT,
  ActivityType.CALL, ActivityType.WHATSAPP,
]);

/** IST (UTC+5:30) calendar-date key, e.g. "2026-06-14". */
function istDateKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function isSameISTDay(d: Date): boolean {
  return istDateKey(d) === istDateKey(new Date());
}

const LOCKED = "This note locked at midnight — notes can only be edited on the day they were logged.";
const NOT_YOURS = "You can only edit notes you logged yourself.";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  const entryId = String(body.entryId ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

  const privileged = me.role === "ADMIN" || me.role === "MANAGER";

  if (kind === "call") {
    const cl = await prisma.callLog.findUnique({ where: { id: entryId }, select: { leadId: true, userId: true, startedAt: true } });
    if (!cl || cl.leadId !== id) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    if (!privileged) {
      if (cl.userId !== me.id) return NextResponse.json({ error: NOT_YOURS }, { status: 403 });
      if (!isSameISTDay(cl.startedAt)) return NextResponse.json({ error: LOCKED }, { status: 403 });
    }
    await prisma.callLog.update({ where: { id: entryId }, data: { notes: note || null } });
    return NextResponse.json({ ok: true });
  }

  if (kind === "whatsapp") {
    if (!note) return NextResponse.json({ error: "WhatsApp message can't be empty" }, { status: 400 });
    const wa = await prisma.whatsAppMessage.findUnique({ where: { id: entryId }, select: { leadId: true, receivedAt: true } });
    if (!wa || wa.leadId !== id) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    // WhatsAppMessage has no per-message user — ownership is already enforced by
    // loadOwnedLead. Agents still get the same-day lock.
    if (!privileged && !isSameISTDay(wa.receivedAt)) return NextResponse.json({ error: LOCKED }, { status: 403 });
    await prisma.whatsAppMessage.update({ where: { id: entryId }, data: { body: note } });
    return NextResponse.json({ ok: true });
  }

  if (kind === "activity") {
    const a = await prisma.activity.findUnique({ where: { id: entryId }, select: { leadId: true, userId: true, type: true, createdAt: true } });
    if (!a || a.leadId !== id) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    if (!EDITABLE_ACTIVITY.has(a.type)) return NextResponse.json({ error: "This entry's note can't be edited." }, { status: 400 });
    if (!privileged) {
      if (a.userId !== me.id) return NextResponse.json({ error: NOT_YOURS }, { status: 403 });
      if (!isSameISTDay(a.createdAt)) return NextResponse.json({ error: LOCKED }, { status: 403 });
    }
    await prisma.activity.update({ where: { id: entryId }, data: { description: note || null } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}

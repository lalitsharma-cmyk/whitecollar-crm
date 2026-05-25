import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

type MeetingType = "OFFICE_MEETING" | "VIRTUAL_MEETING" | "SITE_VISIT";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));

  const type = String(body.type ?? "") as MeetingType;
  const remarks = String(body.remarks ?? "").trim();
  const whenRaw = String(body.when ?? "").trim();
  const durationMin = Number(body.durationMin ?? 0);

  if (!["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"].includes(type)) {
    return NextResponse.json({ error: "Invalid meeting type" }, { status: 400 });
  }
  if (!remarks || remarks.length < 3) {
    return NextResponse.json({ error: "Remarks required (min 3 chars)" }, { status: 400 });
  }

  const when = whenRaw ? new Date(whenRaw) : new Date();
  if (isNaN(when.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  const isFuture = when.getTime() > Date.now();
  const activityStatus = isFuture ? ActivityStatus.PLANNED : ActivityStatus.DONE;

  const title =
    type === "OFFICE_MEETING" ? `🏢 Office meeting${durationMin ? ` (${durationMin}m)` : ""}` :
    type === "VIRTUAL_MEETING" ? `💻 Virtual meeting${durationMin ? ` (${durationMin}m)` : ""}` :
                                  `🚗 Site visit${durationMin ? ` (${durationMin}m)` : ""}`;

  // RESCHEDULE DETECTION: if there's an existing PLANNED activity of this type for
  // this lead that hasn't happened yet, treat this as a reschedule — bump
  // rescheduledCount on the existing row, update its scheduledAt, don't create new.
  const existing = await prisma.activity.findFirst({
    where: {
      leadId: id, userId: me.id, type: ActivityType[type],
      status: ActivityStatus.PLANNED,
      scheduledAt: { gte: new Date() },
    },
    orderBy: { scheduledAt: "asc" },
  });

  if (existing && isFuture) {
    // Reschedule existing PLANNED activity
    await prisma.activity.update({
      where: { id: existing.id },
      data: {
        scheduledAt: when,
        description: `${remarks}\n\n[Rescheduled from ${existing.scheduledAt?.toISOString().slice(0,16) ?? "earlier"}]`,
        rescheduledCount: { increment: 1 },
        // Re-arm the 30-min pre-meeting reminder for the NEW time. Without this,
        // a meeting rescheduled from 3pm → 5pm would silently never get its push,
        // because the dedupe flag was set when the original 3pm reminder fired.
        reminderSentAt: null,
      },
    });
  } else {
    await prisma.activity.create({
      data: {
        leadId: id, userId: me.id,
        type: ActivityType[type],
        status: activityStatus,
        title,
        description: remarks,
        scheduledAt: isFuture ? when : undefined,
        completedAt: !isFuture ? when : undefined,
        attendedByUserId: !isFuture ? me.id : null,
      },
    });
  }

  // If it's a site visit, also stamp the lead's siteVisitDate
  const leadUpdate: Record<string, unknown> = { lastTouchedAt: new Date() };
  if (type === "SITE_VISIT") leadUpdate.siteVisitDate = when;
  if (type === "OFFICE_MEETING" || type === "VIRTUAL_MEETING") leadUpdate.meetingDate = when;
  await prisma.lead.update({ where: { id }, data: leadUpdate });

  return NextResponse.json({ ok: true, rescheduled: !!(existing && isFuture) });
}

// Runs every 5 minutes. Two purposes:
//
//   1. Site visits / office meetings / virtual meetings scheduled to start in
//      ~30 minutes get the owning agent a "🔔 Site visit with X in 30 min"
//      push notification. Dedupes via an Activity flag (reminderSentAt) so the
//      same activity doesn't get notified twice across overlapping 5-min ticks.
//
//   2. Lead.followupDate set for ~10 minutes from now (client said "call me at
//      3pm") gets the owning agent a "☎ Call X in 10 min — they asked you to
//      ring at this time" push. Dedupes via Lead.followupReminderSentAt.
//
// Both 30-min and 10-min thresholds use a half-open window matched to our 5-min
// cron cadence: [target - 2.5min, target + 2.5min] so we catch every activity
// exactly once.
//
// Schedule (vercel.json): "*/5 * * * *"
// Auth: bearer CRON_SECRET.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { ActivityStatus } from "@prisma/client";
import { fmtISTTime } from "@/lib/datetime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN = 60_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // 30-min window: [+27.5 min, +32.5 min]  ← catches one 5-min tick
  const meetingFrom = new Date(now.getTime() + 27.5 * MIN);
  const meetingTo = new Date(now.getTime() + 32.5 * MIN);
  // 10-min window: [+7.5 min, +12.5 min]
  const callbackFrom = new Date(now.getTime() + 7.5 * MIN);
  const callbackTo = new Date(now.getTime() + 12.5 * MIN);

  let meetingsNotified = 0;
  let callbacksNotified = 0;

  // ── 1) Meetings starting in ~30 min ────────────────────────────
  const upcomingMeetings = await prisma.activity.findMany({
    where: {
      type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "EXPO_MEETING", "HOME_VISIT"] },
      status: ActivityStatus.PLANNED,
      scheduledAt: { gte: meetingFrom, lte: meetingTo },
      reminderSentAt: null,  // dedupe across ticks
    },
    include: {
      lead: { select: { id: true, name: true, phone: true } },
      user: { select: { id: true, name: true } },
    },
    take: 50,
  });

  for (const m of upcomingMeetings) {
    if (!m.userId || !m.scheduledAt) continue;
    const label =
      m.type === "SITE_VISIT" ? "🚗 Site visit" :
      m.type === "OFFICE_MEETING" ? "🏢 Office meeting" :
      m.type === "VIRTUAL_MEETING" ? "💻 Virtual meeting" :
      m.type === "EXPO_MEETING" ? "🎪 Expo meeting" :
      "🏠 Home visit";
    const when = fmtISTTime(m.scheduledAt);
    await notify({
      userId: m.userId,
      kind: "REMINDER",
      severity: "WARNING",
      title: `🔔 ${label} in 30 min — ${m.lead?.name ?? "lead"}`,
      body: `Starts at ${when} IST. ${m.lead?.phone ? `Phone: ${m.lead.phone}` : ""}`,
      linkUrl: m.lead ? `/leads/${m.lead.id}` : "/activities",
      leadId: m.leadId,
    });
    await prisma.activity.update({
      where: { id: m.id },
      data: { reminderSentAt: now },
    });
    meetingsNotified++;
  }

  // ── 2) Lead callbacks in ~10 min ───────────────────────────────
  // "Client asked agent to call at 3pm" → reminder at 2:50pm.
  const upcomingCallbacks = await prisma.lead.findMany({
    where: {
      followupDate: { gte: callbackFrom, lte: callbackTo },
      followupReminderSentAt: null,  // dedupe
      ownerId: { not: null },
      status: { notIn: ["WON", "LOST"] },
    },
    select: { id: true, name: true, phone: true, ownerId: true, followupDate: true },
    take: 50,
  });

  for (const l of upcomingCallbacks) {
    if (!l.ownerId || !l.followupDate) continue;
    await notify({
      userId: l.ownerId,
      kind: "REMINDER",
      severity: "WARNING",
      title: `☎ Call ${l.name} in 10 min`,
      body: `They asked you to ring at ${fmtISTTime(l.followupDate)} IST.${l.phone ? ` ${l.phone}` : ""}`,
      linkUrl: `/leads/${l.id}`,
      leadId: l.id,
    });
    await prisma.lead.update({
      where: { id: l.id },
      data: { followupReminderSentAt: now },
    });
    callbacksNotified++;
  }

  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    meetingsNotified,
    callbacksNotified,
    window: {
      meeting: { from: meetingFrom.toISOString(), to: meetingTo.toISOString() },
      callback: { from: callbackFrom.toISOString(), to: callbackTo.toISOString() },
    },
  });
}

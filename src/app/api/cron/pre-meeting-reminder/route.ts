// Runs every 5 minutes. Two purposes:
//
//   1. Site visits / office meetings / virtual meetings scheduled to start in
//      ~30 minutes get the owning agent a "🔔 Site visit with X in 30 min"
//      push notification. Dedupes via an Activity flag (reminderSentAt) so the
//      same activity doesn't get notified twice across overlapping 5-min ticks.
//
//   2. Lead.followupDate (a SCHEDULED FOLLOW-UP) due in ~10 minutes gets the owning
//      agent a "☎ Follow-up with X in 10 min — scheduled at HH:MM IST" push. The text
//      states only what the record holds (a scheduled follow-up); it NEVER claims the
//      client requested a callback. Date-only (midnight-IST) follow-ups are skipped —
//      there is no chosen time, so no timed reminder is invented. Dedupe via
//      Lead.followupReminderSentAt.
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
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { fmtISTTime12 } from "@/lib/datetime";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIN = 60_000;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("pre-meeting-reminder");
  try {
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
    const when = fmtISTTime12(m.scheduledAt);
    await notify({
      userId: m.userId,
      kind: "REMINDER",
      severity: "WARNING",
      title: `🔔 ${label} in 30 min — ${m.lead?.name ?? "lead"}`,
      body: `Starts at ${when} IST. ${m.lead?.phone ? `Phone: ${m.lead.phone}` : ""}`,
      linkUrl: m.lead ? `/leads/${m.lead.id}` : "/activities",
      leadId: m.leadId,
      source: { type: (m.type === "SITE_VISIT" || m.type === "HOME_VISIT") ? "SITE_VISIT" : "MEETING", id: m.id, createdById: null },
    });
    await prisma.activity.update({
      where: { id: m.id },
      data: { reminderSentAt: now },
    });
    meetingsNotified++;
  }

  // ── 1b) Meetings / site visits in ~1 HOUR — remind AGENT + MANAGER (Lalit) ──
  // Separate dedupe flag (reminderSentAt1h) from the 30-min alert. Distinct title
  // ("Meeting Reminder" / "Site Visit Reminder") drives a distinct in-app sound.
  const hourFrom = new Date(now.getTime() + 57.5 * MIN);
  const hourTo = new Date(now.getTime() + 62.5 * MIN);
  // "For now, treat Lalit as the Manager" — the super-admin / escalation point.
  const manager = await prisma.user.findFirst({ where: { isSuperAdmin: true, active: true }, select: { id: true } });
  let hourNotified = 0;

  const upcomingHour = await prisma.activity.findMany({
    where: {
      type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "EXPO_MEETING", "HOME_VISIT"] },
      status: ActivityStatus.PLANNED,
      scheduledAt: { gte: hourFrom, lte: hourTo },
      reminderSentAt1h: null,
    },
    include: {
      lead: { select: { id: true, name: true, phone: true, deletedAt: true, currentStatus: true } },
      user: { select: { id: true, name: true } },
    },
    take: 50,
  });

  for (const m of upcomingHour) {
    if (!m.userId || !m.scheduledAt) continue;
    // Remove-on-cancel guard: if the lead was deleted or went terminal since the
    // meeting was set, mark done (so we stop checking) and send nothing.
    if (m.lead?.deletedAt || (m.lead?.currentStatus && SUPPRESSED_STATUSES.includes(m.lead.currentStatus))) {
      await prisma.activity.update({ where: { id: m.id }, data: { reminderSentAt1h: now } });
      continue;
    }
    const isVisit = m.type === "SITE_VISIT" || m.type === "HOME_VISIT";
    const kind = isVisit ? "Site Visit Reminder" : "Meeting Reminder";
    const icon = isVisit ? "🚗" : "🏢";
    const when = fmtISTTime12(m.scheduledAt);
    const client = m.lead?.name ?? "client";
    // Agent.
    await notify({
      userId: m.userId,
      kind: "REMINDER",
      severity: "WARNING",
      title: `${icon} ${kind}`,
      body: `Your ${isVisit ? "site visit" : "meeting"} with ${client} is at ${when} IST — in 1 hour.${m.lead?.phone ? ` ${m.lead.phone}` : ""}`,
      linkUrl: m.lead ? `/leads/${m.lead.id}` : "/activities",
      leadId: m.leadId,
      source: { type: (m.type === "SITE_VISIT" || m.type === "HOME_VISIT") ? "SITE_VISIT" : "MEETING", id: m.id, createdById: null },
    });
    // Manager (Lalit) — skip if the agent IS the manager.
    if (manager && manager.id !== m.userId) {
      await notify({
        userId: manager.id,
        kind: "REMINDER",
        severity: "WARNING",
        title: `${icon} ${kind} — ${m.user?.name ?? "agent"}`,
        body: `${m.user?.name ?? "An agent"} has a ${isVisit ? "site visit" : "meeting"} with ${client} at ${when} IST — in 1 hour.`,
        linkUrl: m.lead ? `/leads/${m.lead.id}` : "/activities",
        leadId: m.leadId,
        source: { type: (m.type === "SITE_VISIT" || m.type === "HOME_VISIT") ? "SITE_VISIT" : "MEETING", id: m.id, createdById: null },
      });
    }
    await prisma.activity.update({ where: { id: m.id }, data: { reminderSentAt1h: now } });
    hourNotified++;
  }

  // ── 2) Scheduled follow-ups due in ~10 min ─────────────────────
  // A follow-up whose Lead.followupDate is ~10 min away → nudge the owner. TRACEABLE
  // + TRUTHFUL: the ONLY backing record is the Scheduled Follow-up (followupDate), so
  // the body states exactly that — it never implies the CLIENT requested this time
  // (that would invent a callback request the record does not contain). Date-only
  // follow-ups (midnight IST — a date with no chosen time) get NO timed reminder:
  // there is no callback time to remind about, so a "call at HH:MM" alert would be
  // fabricating one (this was the "12:00 AM IST" bug). The daily follow-up reminders
  // cover date-only follow-ups instead.
  const upcomingCallbacks = await prisma.lead.findMany({
    where: {
      followupDate: { gte: callbackFrom, lte: callbackTo },
      followupReminderSentAt: null,  // dedupe
      ownerId: { not: null },
      currentStatus: { notIn: SUPPRESSED_STATUSES },
      deletedAt: null,
    },
    select: { id: true, name: true, phone: true, ownerId: true, followupDate: true },
    take: 50,
  });

  for (const l of upcomingCallbacks) {
    if (!l.ownerId || !l.followupDate) continue;
    // Skip date-only follow-ups (00:00 IST): no specific time was ever set, so a
    // timed reminder would be inventing a callback time. Mark handled (dedupe) so we
    // don't re-evaluate it every 5-min tick; an edit that adds a real time resets
    // followupReminderSentAt and re-arms it.
    const ist = new Date(l.followupDate.getTime() + 330 * MIN);
    if (ist.getUTCHours() === 0 && ist.getUTCMinutes() === 0) {
      await prisma.lead.update({ where: { id: l.id }, data: { followupReminderSentAt: now } });
      continue;
    }
    await notify({
      userId: l.ownerId,
      kind: "REMINDER",
      severity: "WARNING",
      title: `☎ Follow-up with ${l.name} in 10 min`,
      body: `Scheduled follow-up at ${fmtISTTime12(l.followupDate)} IST.${l.phone ? ` ${l.phone}` : ""}`,
      linkUrl: `/leads/${l.id}`,
      leadId: l.id,
      source: { type: "FOLLOWUP", id: l.id, createdById: null },
    });
    await prisma.lead.update({
      where: { id: l.id },
      data: { followupReminderSentAt: now },
    });
    callbacksNotified++;
  }

  await finishCronRun(runId, "OK", undefined, { meetingsNotified, hourNotified, callbacksNotified });
  return NextResponse.json({
    ok: true,
    now: now.toISOString(),
    meetingsNotified,
    hourNotified,
    callbacksNotified,
    window: {
      meeting: { from: meetingFrom.toISOString(), to: meetingTo.toISOString() },
      callback: { from: callbackFrom.toISOString(), to: callbackTo.toISOString() },
    },
  });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

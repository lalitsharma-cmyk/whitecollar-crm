// Lunch-break reminders (Lalit, 2026-06-22). Soft, informational, VERY low
// priority — its own "Lunch Reminder" category + dedicated soft sound (see
// notifSounds.playLunchSound). Fired by the GitHub-Actions cron at:
//   • 2:00 PM IST  → phase "start"  ("Lunch Break Started")
//   • 2:25 PM IST  → phase "ending" ("5 minutes remaining")
//
// Delivered to EVERY active user (all roles/teams/devices) via the existing
// notification infra: in-app bell + soft sound while a tab is open, and Web
// Push to enrolled devices when the app is closed. Never emails (it's just a
// break nudge). Touches no lead / attendance / settings data.
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

export type LunchPhase = "start" | "ending";

const MESSAGES: Record<LunchPhase, { title: string; body: string }> = {
  start: {
    title: "🍽️ Lunch Break Started",
    body: "Lunch break time (2:00–2:30 PM). Please take your scheduled break.",
  },
  ending: {
    title: "⏳ Lunch Break Ending Soon",
    body: "5 minutes remaining in your lunch break.",
  },
};

export async function runLunchReminder(phase: LunchPhase) {
  const msg = MESSAGES[phase];
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true } });
  let sent = 0;
  for (const u of users) {
    try {
      await notify({
        userId: u.id,
        kind: "LUNCH_REMINDER",
        severity: "INFO", // soft / non-urgent — never overrides lead or escalation alerts
        title: msg.title,
        body: msg.body,
        email: false, // informational reminder only — no email
      });
      sent++;
    } catch {
      /* best-effort per user — one failure must not stop the rest */
    }
  }
  return { phase, recipients: users.length, sent };
}

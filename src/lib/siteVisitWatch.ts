import "server-only";
// ────────────────────────────────────────────────────────────────────────────
// SV-2 — stale site-visit / meeting watch (Lalit 2026-07-02).
//
// An agent taps "Going For Site Visit" (or meeting) → an OPEN AgentStatusEvent
// (endedAt null). If they forget to tap "Returned", it stays open forever and the
// field-status board shows them "on site visit" for hours (today: Tanuj, ~8h),
// corrupting duration reporting. This watcher (run from the /api/cron/warm
// heartbeat) nudges the agent so they close it:
//   • 2h open  → reminder #1 to the agent
//   • 4h open  → reminder #2 to the agent
//   • 6h open  → flag Requires-Review + escalate to the manager (Lalit) once
// Dedup via staleRemindersSent / staleReviewFlagged so it never re-notifies on
// every tick. Read-only on everything except its own 3 tracking columns; it never
// closes the visit or fabricates a duration (that stays the agent's / admin's job).
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { resolveManagerUserId } from "@/lib/agentStatus";
import { formatLeadName } from "@/lib/leadName";

const MIN = 60_000;
export const SV_REMIND_1_MIN = 120; // 2h → first "still active" reminder
export const SV_REMIND_2_MIN = 240; // 4h → second reminder
export const SV_REVIEW_MIN = 360; // 6h → Requires-Review + manager escalation

const REMINDER_BODY = (Noun: string) =>
  `Your ${Noun} is still active. Please remember to close it if it has been completed.`;

export interface SiteVisitWatchResult {
  scanned: number;
  reminded: number;
  flagged: number;
}

/** Nudge/escalate agents who left a site visit / meeting field-status open too long. */
export async function runSiteVisitWatch(now: Date = new Date()): Promise<SiteVisitWatchResult> {
  const open = await prisma.agentStatusEvent.findMany({
    where: { status: { in: ["GOING_SITE_VISIT", "GOING_MEETING"] }, endedAt: null },
    select: {
      id: true, userId: true, status: true, startedAt: true,
      staleRemindersSent: true, staleReviewFlagged: true,
      user: { select: { name: true } },
    },
    orderBy: { startedAt: "asc" },
  });
  if (!open.length) return { scanned: 0, reminded: 0, flagged: 0 };

  const managerId = await resolveManagerUserId();
  let reminded = 0;
  let flagged = 0;

  for (const ev of open) {
    const mins = (now.getTime() - ev.startedAt.getTime()) / MIN;
    const isVisit = ev.status === "GOING_SITE_VISIT";
    const noun = isVisit ? "site visit" : "meeting";
    const Noun = isVisit ? "Site Visit" : "Meeting";

    // ── 6h+ → Requires-Review + escalate to manager (once) ──
    if (mins >= SV_REVIEW_MIN && !ev.staleReviewFlagged) {
      const hrs = (mins / 60).toFixed(1);
      await notify({
        userId: ev.userId,
        kind: "AGENT_STATUS",
        severity: "CRITICAL",
        title: `⚠️ ${Noun} still open ${hrs}h — please close it`,
        body: `Your ${noun} has shown as active for ${hrs}h. Close it now if it's done — otherwise your reporting will be inaccurate.`,
        linkUrl: "/dashboard",
        email: false,
      });
      if (managerId && managerId !== ev.userId) {
        const who = formatLeadName(ev.user?.name ?? "") || ev.user?.name || "An agent";
        await notify({
          userId: managerId,
          kind: "AGENT_STATUS",
          severity: "CRITICAL",
          title: `⚠️ Needs review — ${who}'s ${noun} open ${hrs}h`,
          body: `${who}'s ${noun} has been active ${hrs}h without being closed — likely forgotten. Field-time reporting for this ${noun} is unreliable until it's resolved.`,
          linkUrl: "/admin/field-status",
          email: false,
        });
      }
      await prisma.agentStatusEvent.update({
        where: { id: ev.id },
        data: {
          staleReviewFlagged: true,
          staleLastRemindedAt: now,
          staleRemindersSent: Math.max(ev.staleRemindersSent, 2),
        },
      });
      flagged++;
      continue;
    }

    // ── 4h+ → reminder #2 ──
    if (mins >= SV_REMIND_2_MIN && ev.staleRemindersSent < 2 && !ev.staleReviewFlagged) {
      await notify({
        userId: ev.userId, kind: "AGENT_STATUS", severity: "WARNING",
        title: `🚶 ${Noun} still active`, body: REMINDER_BODY(Noun),
        linkUrl: "/dashboard", email: false,
      });
      await prisma.agentStatusEvent.update({
        where: { id: ev.id }, data: { staleRemindersSent: 2, staleLastRemindedAt: now },
      });
      reminded++;
      continue;
    }

    // ── 2h+ → reminder #1 ──
    if (mins >= SV_REMIND_1_MIN && ev.staleRemindersSent < 1) {
      await notify({
        userId: ev.userId, kind: "AGENT_STATUS", severity: "WARNING",
        title: `🚶 ${Noun} still active`, body: REMINDER_BODY(Noun),
        linkUrl: "/dashboard", email: false,
      });
      await prisma.agentStatusEvent.update({
        where: { id: ev.id }, data: { staleRemindersSent: 1, staleLastRemindedAt: now },
      });
      reminded++;
      continue;
    }
  }

  return { scanned: open.length, reminded, flagged };
}

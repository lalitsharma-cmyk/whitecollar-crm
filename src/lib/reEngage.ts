import "server-only";
// Future Re-engage on Reject (Lalit 2026-07-02). When a lead was rejected WITH a
// future re-engage date, this reactivates it on that date: reassign back to the
// owner-at-reject-time (or Lalit if that agent is now inactive), restore a workable
// status, notify the agent + admin. Reversible (reassignment). Never deletes/merges.
// Run from the /api/cron/warm heartbeat (~daily).

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { resolveManagerUserId } from "@/lib/agentStatus";
import { ActivityType, ActivityStatus } from "@prisma/client";

export interface ReEngageResult {
  due: number;
  reEngaged: number;
  toLalitFallback: number;
}

export async function runReEngageDue(now: Date = new Date()): Promise<ReEngageResult> {
  const due = await prisma.lead.findMany({
    where: { deletedAt: null, reEngageAt: { not: null, lte: now } },
    select: { id: true, name: true, reEngageOwnerId: true },
    take: 200,
  });
  if (!due.length) return { due: 0, reEngaged: 0, toLalitFallback: 0 };

  const lalitId = await resolveManagerUserId();
  const ownerIds = [...new Set(due.map((l) => l.reEngageOwnerId).filter((x): x is string => !!x))];
  const activeOwners = new Set(
    ownerIds.length
      ? (await prisma.user.findMany({ where: { id: { in: ownerIds }, active: true }, select: { id: true } })).map((u) => u.id)
      : [],
  );

  let reEngaged = 0;
  let toLalitFallback = 0;
  for (const l of due) {
    const wantOwner = l.reEngageOwnerId;
    const ownerActive = !!wantOwner && activeOwners.has(wantOwner);
    const target = ownerActive ? wantOwner! : (lalitId ?? wantOwner);
    if (!target) continue; // nobody to assign to — leave for a human (rare)
    try {
      await prisma.$transaction([
        prisma.lead.update({
          where: { id: l.id },
          data: {
            ownerId: target, assignedAt: now,
            rejectedAt: null, rejectedById: null, rejectionReason: null, rejectionNote: null,
            currentStatus: "Follow Up", followupDate: now, followupReminderSentAt: null,
            lastTouchedAt: now, reEngageAt: null, reEngageOwnerId: null,
          },
        }),
        prisma.activity.create({
          data: {
            leadId: l.id, userId: null, type: ActivityType.STATUS_CHANGE, status: ActivityStatus.DONE,
            title: `🔁 Re-engaged (scheduled)${ownerActive ? "" : " — original agent inactive, assigned to Lalit"}`,
            completedAt: now,
          },
        }),
        prisma.note.create({
          data: { leadId: l.id, userId: null, body: `🔁 Auto re-engaged today (was rejected with a future re-engage date). Reactivated + assigned to ${ownerActive ? "the original agent" : "Lalit (original agent inactive)"}.` },
        }),
      ]);

      await notify({
        userId: target, kind: "LEAD_ASSIGNED", severity: "WARNING",
        title: `🔁 Re-engage due — ${l.name ?? "a client"}`,
        body: `You scheduled this client for a future call — today's the day. Reactivated + assigned to you. Give them a ring.`,
        linkUrl: `/leads/${l.id}`, leadId: l.id, email: false,
        source: { type: "REMINDER", id: l.id, createdById: null },
      });
      if (lalitId && lalitId !== target) {
        await notify({
          userId: lalitId, kind: "LEAD_ASSIGNED", severity: ownerActive ? "INFO" : "WARNING",
          title: `🔁 Re-engage fired — ${l.name ?? "client"}`,
          body: ownerActive ? `Reactivated + assigned back to the original agent.` : `Original agent is inactive — assigned to you instead.`,
          linkUrl: `/leads/${l.id}`, leadId: l.id, email: false,
          source: { type: "REMINDER", id: l.id, createdById: null },
        });
      }
      reEngaged++;
      if (!ownerActive) toLalitFallback++;
    } catch {
      // skip a single bad row; the sweep continues
    }
  }
  return { due: due.length, reEngaged, toLalitFallback };
}

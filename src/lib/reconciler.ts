import { prisma } from "@/lib/prisma";
import { notify, notifyRoles } from "@/lib/notify";
import { LeadStatus } from "@prisma/client";
import { chooseOwnerForNewLead } from "@/lib/assignmentWindow";

// The reconciler runs on every dashboard/leads page load (cheap, deduped).
// It enforces two SLAs without needing a separate cron service:
//   • 5-min auto-assign: any unassigned lead >5 min old → assign via round-robin
//   • 15-min call SLA: assigned lead with no call after 15 min → notify agent + admin
//
// Idempotent: each notification is only sent once thanks to slaEscalated / ownerId flags.

const AUTO_ASSIGN_AFTER_MIN = 5;
const FIRST_CALL_SLA_MIN = 15;

let lastRunAt = 0;
const MIN_RERUN_GAP_MS = 30_000; // throttle to once per 30s

export interface ReconcileResult {
  autoAssigned: number;
  slaEscalated: number;
  flagged?: number;
  skipped: boolean;
}

export async function runReconciler(): Promise<ReconcileResult> {
  // Throttle — multiple page loads within 30s share one result
  const now = Date.now();
  if (now - lastRunAt < MIN_RERUN_GAP_MS) {
    return { autoAssigned: 0, slaEscalated: 0, flagged: 0, skipped: true };
  }
  lastRunAt = now;

  let autoAssigned = 0, slaEscalated = 0;

  // ── 1) Auto-assign anything unowned >5 minutes ──────────────────────
  const cutoffAssign = new Date(Date.now() - AUTO_ASSIGN_AFTER_MIN * 60 * 1000);
  const orphans = await prisma.lead.findMany({
    where: {
      ownerId: null,
      createdAt: { lte: cutoffAssign },
      status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
      // Cold-data imports are admin-assigned only — skip them in the 5-min auto-sweep.
      isColdCall: false,
    },
    take: 50,
  });

  for (const lead of orphans) {
    const team = lead.forwardedTeam ?? null;
    // Use time-window-aware chooser: 10am-7pm round-robin among present,
    // 7-10pm → Lalit, 10pm-10am → null (skip, keep in admin's morning queue).
    const choice = await chooseOwnerForNewLead(team);
    if (!choice.userId) {
      // Overnight window — leave unassigned for morning admin handling
      continue;
    }
    const agent = await prisma.user.findUnique({ where: { id: choice.userId } });
    if (!agent) continue;
    const now = new Date();
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ownerId: agent.id,
        assignedAt: now,
        slaFirstCallBy: new Date(now.getTime() + FIRST_CALL_SLA_MIN * 60 * 1000),
        slaEscalated: false,
      },
    });
    const reason = choice.window.kind === "EVENING_LALIT"
      ? "Evening (7-10pm) — escalated to Lalit"
      : choice.fallbackReason ?? "10am-7pm round-robin among present agents";
    await prisma.assignment.create({ data: { leadId: lead.id, userId: agent.id, reason } });
    await notify({
      userId: agent.id,
      kind: "LEAD_ASSIGNED",
      severity: "WARNING",
      title: `New lead auto-assigned: ${lead.name}`,
      body: `${reason}. Call within ${FIRST_CALL_SLA_MIN}m.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "AUTO_ASSIGN_FIRED",
      severity: "INFO",
      title: `Auto-assigned ${lead.name} → ${agent.name}`,
      body: reason,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
    autoAssigned++;
  }

  // ── 2) Escalate 15-min call SLA breaches ───────────────────────────
  const overdue = await prisma.lead.findMany({
    where: {
      slaFirstCallBy: { lte: new Date() },
      slaEscalated: false,
      ownerId: { not: null },
      status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
    },
    include: { owner: true, callLogs: { take: 1 } },
    take: 50,
  });

  for (const lead of overdue) {
    if (lead.callLogs.length > 0) {
      // Agent already called — just clear the flag
      await prisma.lead.update({ where: { id: lead.id }, data: { slaEscalated: true } });
      continue;
    }
    if (!lead.ownerId || !lead.owner) continue;
    await prisma.lead.update({ where: { id: lead.id }, data: { slaEscalated: true } });
    await notify({
      userId: lead.ownerId,
      kind: "CALL_SLA_BREACH",
      severity: "CRITICAL",
      title: `⚠ Call SLA breach: ${lead.name}`,
      body: `15 minutes passed since assignment. Please call now or mark callback.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "CALL_SLA_BREACH",
      severity: "CRITICAL",
      title: `SLA breach: ${lead.owner.name} hasn't called ${lead.name}`,
      body: `Assigned ${Math.round((Date.now() - (lead.assignedAt?.getTime() ?? Date.now())) / 60000)}m ago, no call logged.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
    slaEscalated++;
  }

  // ── 3) "Needs You" flag — leads where manager push could help ──
  // Conditions: closing-stage + no contact 24h, OR 3+ consecutive not-picked attempts
  const closingLeads = await prisma.lead.findMany({
    where: {
      status: { in: ["NEGOTIATION", "SITE_VISIT", "QUALIFIED"] },
      needsManagerReview: false,
      OR: [
        { lastTouchedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
      ],
    },
    include: { callLogs: { orderBy: { startedAt: "desc" }, take: 10 } },
    take: 100,
  });
  let flagged = 0;
  for (const lead of closingLeads) {
    let reason = "";
    if (lead.lastTouchedAt && lead.lastTouchedAt < new Date(Date.now() - 24 * 3600 * 1000)) {
      reason = `${lead.status} stage idle >24h — manager push may close`;
    }
    // Not-picked streak detection
    let streak = 0;
    for (const c of lead.callLogs) {
      if (c.outcome === "NOT_PICKED" || c.outcome === "SWITCHED_OFF" || c.outcome === "BUSY") streak++;
      else break;
    }
    if (streak >= 3) reason = `${streak} consecutive not-picked — try a different number / time slot`;
    if (!reason) continue;
    await prisma.lead.update({
      where: { id: lead.id },
      data: { needsManagerReview: true, managerReviewReason: reason, flaggedAt: new Date() },
    });
    // Notify admin/manager
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "REMINDER",
      severity: "WARNING",
      title: `🚩 ${lead.name} needs your attention`,
      body: reason,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
    flagged++;
  }

  return { autoAssigned, slaEscalated, flagged, skipped: false };
}

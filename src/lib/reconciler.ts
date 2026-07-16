import { prisma } from "@/lib/prisma";
import { notify, notifyRoles } from "@/lib/notify";
import { chooseOwnerForNewLead, currentWindow } from "@/lib/assignmentWindow";
import { resolveAutoAssignOwner } from "@/lib/assignment";
import { getRoundRobinEnabled, getAutoAssignmentEnabled, getAutoEscalationEnabled, getSlaBreachEnabled, getFreshUntouchedEscalationEnabled } from "@/lib/settings";
import { isTeamClassified } from "@/lib/teamRouting";
import { SUPPRESSED_STATUSES, CLOSING_STATUSES } from "@/lib/lead-statuses";
import { COLD_ORIGINS } from "@/lib/leadScope";
import { FIRST_CONTACT_PENDING_WHERE } from "@/lib/freshLeads";
import { istDayRange } from "@/lib/datetime";

// The reconciler runs on every dashboard/leads page load (cheap, deduped).
// It enforces two SLAs without needing a separate cron service:
//   • 5-min auto-assign: any unassigned lead >5 min old → assign via round-robin
//   • 15-min call SLA: assigned lead with no call after 15 min → notify agent + admin
//   • fresh-untouched: assigned-today lead with no first contact → 15m agent nudge,
//     45m manager/Lalit escalation (gated OFF by default — Lalit flips it on)
//
// Idempotent: each notification is only sent once thanks to slaEscalated / ownerId
// flags, or (fresh-untouched) a same-day Notification-ledger check.
// STATUS IS THE ONLY WORKFLOW — no stage/won/lost checks.

const AUTO_ASSIGN_AFTER_MIN = 5;
const FIRST_CALL_SLA_MIN = 15;
const FRESH_AGENT_NUDGE_MIN = 15;     // untouched this long → nudge the owning agent
const FRESH_MANAGER_ESCALATE_MIN = 45; // still untouched → escalate to managers/Lalit

let lastRunAt = 0;
const MIN_RERUN_GAP_MS = 30_000; // throttle to once per 30s

export interface ReconcileResult {
  autoAssigned: number;
  slaEscalated: number;
  flagged?: number;
  freshEscalated?: number;
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

  // Notifications + escalation ALERTS always fire here now. Only the automated
  // ACTIONS are gated by their per-feature Automation Controls flag (default OFF).
  const [autoAssignmentOn, roundRobinFlag, autoEscalationOn, slaBreachOn, freshUntouchedOn] = await Promise.all([
    getAutoAssignmentEnabled(), getRoundRobinEnabled(), getAutoEscalationEnabled(), getSlaBreachEnabled(), getFreshUntouchedEscalationEnabled(),
  ]);

  // ── 1) Auto-assign anything unowned >5 minutes (AUTOMATION — gated) ──
  const roundRobinOn = autoAssignmentOn && roundRobinFlag;
  const cutoffAssign = new Date(Date.now() - AUTO_ASSIGN_AFTER_MIN * 60 * 1000);
  const orphans = roundRobinOn ? await prisma.lead.findMany({
    where: {
      ownerId: null,
      rejectedAt: null,        // never auto-assign a rejected (hard-unassigned) lead
      deletedAt: null,
      createdAt: { lte: cutoffAssign },
      currentStatus: { notIn: SUPPRESSED_STATUSES },
      isColdCall: false,
      forwardedTeam: { not: null },
    },
    take: 50,
  }) : [];

  for (const lead of orphans) {
    if (!isTeamClassified(lead.forwardedTeam)) continue;

    const team = lead.forwardedTeam ?? null;
    // Lalit 2026-06-30: prefer the fixed team rule (Dubai→Lalit / Tue-IST India→
    // Yasir); fall back to legacy round-robin only for an unknown team. (This sweep
    // only runs when round-robin is ON — OFF by default → dormant.)
    // 2026-07-17: Routing Scheduler consulted first — a live admin rule wins; the
    // pause override leaves orphans unassigned; no rule → identical fixed team rule.
    const resolution = await resolveAutoAssignOwner({
      module: "lead-intake",
      team,
      market: lead.market,
      source: lead.source,
      project: lead.sourceDetail,
      country: lead.country,
    });
    if (resolution.kind === "paused") continue; // lead stays unassigned under the emergency override
    const fixed = resolution.userId;
    const choice = fixed
      ? { userId: fixed as string | null, window: currentWindow(), fallbackReason: resolution.kind === "rule" ? resolution.reason : "fixed team rule (Lalit 2026-06-30)" }
      : await chooseOwnerForNewLead(team);
    if (!choice.userId) continue;

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
        ...(resolution.kind === "rule"
          ? { routingMethod: "rule", routingSource: `routing_rule:${resolution.ruleId}`, routingReason: resolution.reason }
          : {}),
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
      source: { type: "ASSIGNMENT", id: lead.id, createdById: null },
    });
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "AUTO_ASSIGN_FIRED",
      severity: "INFO",
      title: `Auto-assigned ${lead.name} → ${agent.name}`,
      body: reason,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
      source: { type: "ASSIGNMENT", id: lead.id, createdById: null },
    });
    autoAssigned++;
  }

  // ── 2) Escalate 15-min call SLA breaches — PAUSED by default (Lalit 2026-06-22).
  //       Resume via Settings `slaBreach.enabled`. Bounded to breaches in the last
  //       6h so a resume can NEVER re-alert an ancient backlog. ──
  const overdue = slaBreachOn ? await prisma.lead.findMany({
    where: {
      slaFirstCallBy: { lte: new Date(), gte: new Date(Date.now() - 6 * 3600 * 1000) },
      slaEscalated: false,
      ownerId: { not: null },
      deletedAt: null,
      currentStatus: { notIn: SUPPRESSED_STATUSES },
    },
    include: { owner: true, callLogs: { take: 1 } },
    take: 50,
  }) : [];

  for (const lead of overdue) {
    if (!isTeamClassified(lead.forwardedTeam)) continue;

    if (lead.callLogs.length > 0) {
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
      source: { type: "ASSIGNMENT", id: lead.id, createdById: null },
    });
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "CALL_SLA_BREACH",
      severity: "CRITICAL",
      title: `SLA breach: ${lead.owner.name} hasn't called ${lead.name}`,
      body: `Assigned ${Math.round((Date.now() - (lead.assignedAt?.getTime() ?? Date.now())) / 60000)}m ago, no call logged.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
      source: { type: "ASSIGNMENT", id: lead.id, createdById: null },
    });
    slaEscalated++;
  }

  // ── 3) "Needs You" AUTO-flagging — an automatic escalation ACTION (it mutates
  //       needsManagerReview), so it's gated OFF by default behind autoEscalation. ──
  const closingLeads = autoEscalationOn ? await prisma.lead.findMany({
    where: {
      deletedAt: null,
      currentStatus: { in: CLOSING_STATUSES },
      needsManagerReview: false,
      OR: [
        { lastTouchedAt: { lt: new Date(Date.now() - 24 * 3600 * 1000) } },
      ],
    },
    include: { callLogs: { orderBy: { startedAt: "desc" }, take: 10 } },
    take: 100,
  }) : [];
  let flagged = 0;
  for (const lead of closingLeads) {
    if (!isTeamClassified(lead.forwardedTeam)) continue;

    let reason = "";
    if (lead.lastTouchedAt && lead.lastTouchedAt < new Date(Date.now() - 24 * 3600 * 1000)) {
      reason = `${lead.currentStatus ?? "Lead"} status idle >24h — manager push may close`;
    }
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
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "REMINDER",
      severity: "WARNING",
      title: `🚩 ${lead.name} needs your attention`,
      body: reason,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
      source: { type: "ESCALATION", id: lead.id, createdById: null },
    });
    flagged++;
  }

  // ── 4) Fresh-untouched escalation (Lalit 2026-07-01) — GATED OFF by default ──
  //   A lead assigned TODAY with no first contact logged (no call / WhatsApp /
  //   email / meeting / note) is the one most likely to be missed. Nudge the
  //   owning agent at 15 min; escalate to managers/Lalit at 45 min. Idempotent
  //   via a same-IST-day Notification-ledger check (no schema change / no new
  //   enum — reuses the REMINDER kind + a stable "⚡ Fresh lead" title marker).
  let freshEscalated = 0;
  if (freshUntouchedOn) {
    const { start } = istDayRange();
    const nowMs = Date.now();
    const candidates = await prisma.lead.findMany({
      where: {
        ownerId: { not: null },
        deletedAt: null,
        rejectedAt: null,
        isColdCall: false,
        leadOrigin: { notIn: COLD_ORIGINS },
        // Assigned today (IST) AND at least the agent-nudge age old.
        assignedAt: { gte: start, lte: new Date(nowMs - FRESH_AGENT_NUDGE_MIN * 60 * 1000) },
        currentStatus: { notIn: SUPPRESSED_STATUSES },
        ...FIRST_CONTACT_PENDING_WHERE, // no call + no first-contact activity
      },
      include: { owner: true },
      take: 50,
    });

    if (candidates.length > 0) {
      // One batched ledger read → which leads already got which nudge today.
      const ids = candidates.map((c) => c.id);
      const priorNotifs = await prisma.notification.findMany({
        where: { leadId: { in: ids }, createdAt: { gte: start }, title: { startsWith: "⚡ Fresh lead" } },
        select: { leadId: true, title: true },
      });
      const agentNudged = new Set(priorNotifs.filter((n) => !n.title.includes("STILL")).map((n) => n.leadId));
      const managerEscalated = new Set(priorNotifs.filter((n) => n.title.includes("STILL")).map((n) => n.leadId));

      for (const lead of candidates) {
        if (!isTeamClassified(lead.forwardedTeam)) continue;
        if (!lead.ownerId || !lead.owner) continue;
        const ageMin = Math.round((nowMs - (lead.assignedAt?.getTime() ?? nowMs)) / 60000);

        // 45-min manager/Lalit escalation (checked first so a badly-late lead
        // escalates even if the 15-min agent nudge was somehow missed).
        if (ageMin >= FRESH_MANAGER_ESCALATE_MIN && !managerEscalated.has(lead.id)) {
          await notifyRoles(["ADMIN", "MANAGER"], {
            kind: "REMINDER",
            severity: "CRITICAL",
            title: `⚡ Fresh lead STILL untouched (${ageMin}m): ${lead.name}`,
            body: `${lead.owner.name} hasn't logged first contact ${ageMin}m after assignment. Please follow up.`,
            linkUrl: `/leads/${lead.id}`,
            leadId: lead.id,
            source: { type: "ESCALATION", id: lead.id, createdById: null },
          });
          freshEscalated++;
          continue;
        }
        // 15-min agent nudge.
        if (ageMin >= FRESH_AGENT_NUDGE_MIN && !agentNudged.has(lead.id)) {
          await notify({
            userId: lead.ownerId,
            kind: "REMINDER",
            severity: "WARNING",
            title: `⚡ Fresh lead untouched: ${lead.name}`,
            body: `Assigned ${ageMin}m ago — no call, WhatsApp, or note yet. Make first contact now.`,
            linkUrl: `/leads/${lead.id}`,
            leadId: lead.id,
            source: { type: "ASSIGNMENT", id: lead.id, createdById: null },
          });
          freshEscalated++;
        }
      }
    }
  }

  return { autoAssigned, slaEscalated, flagged, freshEscalated, skipped: false };
}

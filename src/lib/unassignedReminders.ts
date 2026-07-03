// Unassigned-lead reminders (FINAL logic — owner-approved 2026-06-18).
//
// Real-time inbound leads (website / direct entry) that nobody has picked up
// get escalating nudges to ADMINs at 15 / 30 / 60 minutes, plus an 8 PM IST
// end-of-day "still unassigned" summary. Notification-only — NOTHING is
// auto-assigned, no lead data is modified. Audited via CronRun + the
// Notification rows themselves.
//
// Dedupe is window-based (no new DB column, no migration): the escalation cron
// runs every 5 min, and each level fires for leads whose age sits in a single
// 5-min half-open window [mins, mins+5). A lead crosses each threshold in
// exactly one tick, so it's notified once per level. If it gets assigned before
// the next threshold, ownerId is no longer null → it drops out. Mirrors the
// proven pattern in api/cron/pre-meeting-reminder.
//
// Bulk CSV/Sheet imports are EXCLUDED (importBatchId != null) — those are
// triaged in batches inside Master Data, not real-time SLA events, so they
// must never trigger a notification storm.

import { prisma } from "@/lib/prisma";
import { notifyRoles } from "@/lib/notify";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import type { Prisma, NotifSeverity } from "@prisma/client";

const MIN = 60_000;

/** A lead that genuinely needs an admin to assign it: real-time inbound (not a
 *  bulk import), live, not a cold-call record, still workable, no owner yet. */
function unassignedBase(): Prisma.LeadWhereInput {
  return {
    ownerId: null,
    deletedAt: null,
    rejectedAt: null,          // rejected leads are unassigned for history only — never re-alert to assign them
    isColdCall: false,
    importBatchId: null,
    OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
  };
}

const LEVELS: { mins: number; label: string; sev: NotifSeverity }[] = [
  { mins: 15, label: "15 minutes", sev: "WARNING" },
  { mins: 30, label: "30 minutes", sev: "WARNING" },
  { mins: 60, label: "1 hour", sev: "CRITICAL" },
];

/** Escalation pass — call every ~5 minutes. */
export async function runUnassignedEscalation(now: Date = new Date()) {
  let notified = 0;
  const perLevel: Record<string, number> = {};
  for (const lvl of LEVELS) {
    // age ∈ [mins, mins+5) → createdAt ∈ [now-(mins+5), now-mins)
    const from = new Date(now.getTime() - (lvl.mins + 5) * MIN);
    const to = new Date(now.getTime() - lvl.mins * MIN);
    const leads = await prisma.lead.findMany({
      where: { ...unassignedBase(), createdAt: { gte: from, lt: to } },
      select: { id: true, name: true, sourceRaw: true, forwardedTeam: true },
      take: 200,
    });
    for (const l of leads) {
      const where = l.forwardedTeam ? ` (${l.forwardedTeam} team)` : "";
      await notifyRoles(["ADMIN"], {
        kind: "REMINDER",
        severity: lvl.sev,
        title: `⏳ Unassigned ${lvl.label} — please assign`,
        body: `"${l.name}"${where} is still unassigned after ${lvl.label}. Open it to assign an agent.`,
        linkUrl: `/leads/${l.id}`,
        leadId: l.id,
        email: lvl.mins >= 60, // only the 1-hour escalation also emails
        source: { type: "ASSIGNMENT", id: l.id, createdById: null },
      });
      notified++;
    }
    perLevel[`${lvl.mins}m`] = leads.length;
  }
  return { mode: "escalation", notified, perLevel };
}

/** End-of-day summary — call once daily (8 PM IST). Skips sending when clear. */
export async function runUnassignedSummary(now: Date = new Date()) {
  const leads = await prisma.lead.findMany({
    where: unassignedBase(),
    select: { id: true, name: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  if (leads.length === 0) return { mode: "summary", count: 0, notified: false };

  const oldestMins = Math.floor((now.getTime() - leads[0].createdAt.getTime()) / MIN);
  const oldestLabel = oldestMins >= 1440 ? `${Math.floor(oldestMins / 1440)}d` : oldestMins >= 60 ? `${Math.floor(oldestMins / 60)}h` : `${oldestMins}m`;
  const names = leads.slice(0, 5).map((l) => l.name).join(", ");
  const n = leads.length;

  await notifyRoles(["ADMIN"], {
    kind: "REMINDER",
    severity: "WARNING",
    title: `🌙 ${n} inbound lead${n > 1 ? "s" : ""} still unassigned`,
    body: `End-of-day check — ${n} real-time lead${n > 1 ? "s have" : " has"} no agent yet (oldest ~${oldestLabel}). e.g. ${names}${n > 5 ? `, +${n - 5} more` : ""}. Please assign in Master Data.`,
    linkUrl: `/master-data?cat=workable`,
    email: true,
    source: { type: "ASSIGNMENT", id: null, createdById: null },
  });
  return { mode: "summary", count: n, notified: true };
}

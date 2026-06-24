// followupGate — the SINGLE source of truth for "has this lead had a valid
// contact attempt today?" used by the follow-up completion workflow.
//
// WHY: an agent must not be able to mark a follow-up "Complete" without first
// logging a real client touch (call / WhatsApp / email) for the current cycle.
// This helper answers that question once, and is reused by:
//   • the server gate in /api/leads/[id]/action-complete (rejects 400 for agents)
//   • all 4 UI surfaces (Action List, Leads table, Lead card, Lead detail) to
//     disable the Complete button + show the "contact required" tooltip
//   • the follow-up-date-change protection on the inline edit / SchedulingField
//
// DRY: every caller funnels through hasContactActivityToday / the batch variant
// so the definition can never drift between server and client surfaces.
//
// DEFINITION ("valid contact activity today"): an Activity for the lead dated
// TODAY (IST) whose type is a contact kind — CALL, WHATSAPP or EMAIL. These are
// exactly the types the log-call path (ActivityType.CALL), the WhatsApp log path
// (ActivityType.WHATSAPP) and any email log write. We deliberately do NOT count
// NOTE / STATUS_CHANGE / TASK / REMINDER_FIRED / system rows — those aren't a
// client contact attempt.

import { prisma } from "@/lib/prisma";
import { ActivityType } from "@prisma/client";
import { istDayRange } from "@/lib/datetime";

/** The Activity types that count as a real client contact attempt. */
export const CONTACT_ACTIVITY_TYPES: ActivityType[] = [
  ActivityType.CALL,
  ActivityType.WHATSAPP,
  ActivityType.EMAIL,
];

/**
 * The outcome strings (as stored on Activity.outcome) that mean we actually
 * REACHED the client (a two-way connection), not just an attempt. log-call
 * stores `CallOutcome.replaceAll("_"," ")`, so CONNECTED/INTERESTED stay as
 * "CONNECTED"/"INTERESTED". Used to decide whether a snooze needs a reason
 * (no response → reason required) and to bucket "completed after a connect".
 */
const CONNECTED_OUTCOMES = new Set(["CONNECTED", "INTERESTED"]);

export function isConnectedOutcome(outcome: string | null | undefined): boolean {
  if (!outcome) return false;
  return CONNECTED_OUTCOMES.has(outcome.trim().toUpperCase());
}

export interface ContactTodayInfo {
  /** True when ≥1 contact activity (call/WA/email) exists today (IST). */
  has: boolean;
  /** True when at least one of today's contact activities was a connected one. */
  connected: boolean;
  /** The dominant channel of the most recent contact today, for reporting. */
  channel: "CALL" | "WHATSAPP" | "EMAIL" | null;
}

/**
 * Detailed contact info for ONE lead today (IST). Prefer this when you also need
 * the connected flag / channel (e.g. the snooze-reason rule, report capture).
 */
export async function contactActivityTodayInfo(
  leadId: string,
  day?: string | Date,
): Promise<ContactTodayInfo> {
  const { start, end } = istDayRange(day);
  const rows = await prisma.activity.findMany({
    where: {
      leadId,
      type: { in: CONTACT_ACTIVITY_TYPES },
      // Match on the activity's own timestamp. Logged calls/WA set completedAt
      // = now AND createdAt = now; use createdAt so a back-dated completedAt
      // (admin edit) can't accidentally satisfy "today". createdAt is the
      // immutable wall-clock the row was written.
      createdAt: { gte: start, lt: end },
    },
    select: { type: true, outcome: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return { has: false, connected: false, channel: null };
  const connected = rows.some((r) => isConnectedOutcome(r.outcome));
  const top = rows[0].type;
  const channel = top === ActivityType.CALL ? "CALL"
    : top === ActivityType.WHATSAPP ? "WHATSAPP"
    : top === ActivityType.EMAIL ? "EMAIL"
    : null;
  return { has: true, connected, channel };
}

/**
 * True if the lead has a valid contact activity today (IST). The lean boolean
 * used by the server gate + the date-change protection.
 */
export async function hasContactActivityToday(
  leadId: string,
  day?: string | Date,
): Promise<boolean> {
  const { start, end } = istDayRange(day);
  const n = await prisma.activity.count({
    where: {
      leadId,
      type: { in: CONTACT_ACTIVITY_TYPES },
      createdAt: { gte: start, lt: end },
    },
  });
  return n > 0;
}

/**
 * Batch variant for list surfaces (Leads table / cards / Action List). Returns a
 * Set of leadIds that DO have a contact activity today, so the page can compute
 * each row's flag with ONE query instead of N. Empty input → empty Set.
 */
export async function contactActivityByLeadToday(
  leadIds: string[],
  day?: string | Date,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (leadIds.length === 0) return out;
  const { start, end } = istDayRange(day);
  // groupBy is the cheapest way to get "which of these leads have ≥1 row" — one
  // indexed query over Activity(leadId, createdAt). We don't need the count, just
  // the presence, but groupBy returns the distinct leadIds that matched.
  const rows = await prisma.activity.groupBy({
    by: ["leadId"],
    where: {
      leadId: { in: leadIds },
      type: { in: CONTACT_ACTIVITY_TYPES },
      createdAt: { gte: start, lt: end },
    },
  });
  for (const r of rows) out.add(r.leadId);
  return out;
}

// ── EOD follow-up-workflow report metrics ─────────────────────────────────────
// Counts the day's follow-up actions for one agent (or all when ownerId is
// null), keyed off the actionContext token the complete/snooze/escalate routes
// stamp on each Activity. Every bucket is its own count → reconcilable (the
// number == the rows you'd see if you drilled in). Used by the Daily Report.

export interface FollowupWorkflowStats {
  /** Follow-ups that were due today (IST): the ones still pending + everything
   *  actioned today (completed/snoozed/escalated). A live denominator. */
  dueToday: number;
  completed: number;
  completedAfterCall: number;
  completedAfterWhatsapp: number;
  completedAfterEmail: number;
  /** Completed by an admin/manager bypass with no contact logged (rare). */
  completedWithoutContact: number;
  snoozed: number;
  snoozedWithoutContact: number;
  escalated: number;
  followupDateChanges: number;
  /** Still pending at end of day: leads whose followupDate is in the day window
   *  and that weren't completed/snoozed away. (For a PAST day this is whatever
   *  was left un-actioned; for today it's the live remaining queue.) */
  pendingAtEod: number;
}

/**
 * Compute the follow-up workflow metrics for a given agent + IST day.
 *   ownerId — the agent to scope to (Daily Report is per-agent). Pass null for
 *             an all-agents roll-up.
 *   day     — the IST day (Date or "YYYY-MM-DD"); defaults to today.
 */
export async function followupWorkflowStats(
  ownerId: string | null,
  day?: string | Date,
): Promise<FollowupWorkflowStats> {
  const { start, end } = istDayRange(day);
  // Activity scope: rows written this IST day, optionally by this agent, on a
  // non-deleted lead. actionContext is only set on workflow rows, so filtering
  // on its prefixes naturally excludes everything else.
  const actWhere = {
    completedAt: { gte: start, lt: end },
    ...(ownerId ? { userId: ownerId } : {}),
    lead: { deletedAt: null },
  } as const;

  const countCtx = (token: string | { startsWith: string }) =>
    prisma.activity.count({
      where: {
        ...actWhere,
        actionContext: typeof token === "string" ? token : { startsWith: token.startsWith },
      },
    });

  // Pending-at-EOD: leads owned by the agent with a followupDate still inside the
  // day window. Completing clears followupDate; snoozing pushes it out — so this
  // is exactly the un-actioned remainder.
  const pendingWhere = {
    deletedAt: null,
    followupDate: { gte: start, lt: end },
    ...(ownerId ? { ownerId } : {}),
  } as const;

  const [
    completedAfterCall,
    completedAfterWhatsapp,
    completedAfterEmail,
    completedWithoutContact,
    snoozed,
    snoozedWithoutContact,
    escalated,
    followupDateChanges,
    pendingAtEod,
  ] = await Promise.all([
    countCtx("complete:call"),
    countCtx("complete:whatsapp"),
    countCtx("complete:email"),
    countCtx("complete:none"),
    countCtx({ startsWith: "snooze:" }),
    countCtx("snooze:no-contact"),
    countCtx("escalate"),
    countCtx({ startsWith: "followup-change:" }),
    prisma.lead.count({ where: pendingWhere }),
  ]);

  const completed = completedAfterCall + completedAfterWhatsapp + completedAfterEmail + completedWithoutContact;
  // Due today = everything actioned today + whatever is still pending.
  const dueToday = completed + snoozed + escalated + pendingAtEod;

  return {
    dueToday,
    completed,
    completedAfterCall,
    completedAfterWhatsapp,
    completedAfterEmail,
    completedWithoutContact,
    snoozed,
    snoozedWithoutContact,
    escalated,
    followupDateChanges,
    pendingAtEod,
  };
}

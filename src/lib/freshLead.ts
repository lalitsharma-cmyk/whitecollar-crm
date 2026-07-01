// ────────────────────────────────────────────────────────────────────────────
// freshLead.ts — the SINGLE source of truth for "is this a Fresh Lead?".
//
// A FRESH LEAD is a lead newly ASSIGNED to an agent that has NOT yet had a
// meaningful first interaction. It is the operational foundation of the AI Sales
// OS: every surface (dashboard card, lead list, lead detail, AI actions, agent +
// manager dashboards) consumes THIS module so the state can never drift, and later
// intelligence (AI Priority Score, Daily Planner, First-Response SLA, agent/manager
// analytics, missed-revenue detection) reads the same signal.
//
// TWO independent signals + the derived "fresh":
//   • assignedToday        — Lead.assignedAt is within today (IST). Set by EVERY
//     assignment path (assignLeadTo / round-robin / bulk / reconciler / AI), so it
//     covers website / portal / manual / import / buyer→lead / cold→lead / manager /
//     AI-assign / AI-reactivation uniformly. Auto-expires at IST midnight (computed
//     per request — no cron).
//   • firstContactPending  — no MEANINGFUL first interaction has happened yet.
//     Auto-expires the instant a meaningful interaction is logged.
//   • isFresh = assignedToday && firstContactPending — drives the pin + highlight;
//     clears on EITHER the day rolling over OR the first meaningful interaction.
//
// MEANINGFUL first interaction (badge clears) = a connected call, a logged WhatsApp
// conversation, a scheduled meeting / site visit, or a substantial manual note.
// NOT: auto/system rows, lead-created, assignment, status-change, reminders, a bare
// page view. Reuses followupGate.isConnectedOutcome so "connected" never drifts.
//
// Timing/threshold rules are configurable via Settings (getFreshLeadConfig).
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import { prisma } from "@/lib/prisma";
import { ActivityType } from "@prisma/client";
import { istDayRange } from "@/lib/datetime";
import { isConnectedOutcome } from "@/lib/followupGate";

/** Meeting / site-visit activity types — a scheduled meaningful engagement. */
export const MEETING_ACTIVITY_TYPES: ActivityType[] = [
  ActivityType.SITE_VISIT,
  ActivityType.OFFICE_MEETING,
  ActivityType.VIRTUAL_MEETING,
  ActivityType.HOME_VISIT,
  ActivityType.EXPO_MEETING,
  ActivityType.MEETING,
];

/** A NOTE counts as a meaningful first touch only when it's at least this long
 *  (a substantial manual note, not a one-word jot). Configurable via Settings. */
export const DEFAULT_SUBSTANTIAL_NOTE_LEN = 15;

export interface FreshLeadState {
  /** Lead.assignedAt is within today (IST). */
  assignedToday: boolean;
  /** No meaningful first interaction has happened yet. */
  firstContactPending: boolean;
  /** The pinned/highlighted state: newly assigned today AND not yet contacted. */
  isFresh: boolean;
}

/** True when `assignedAt` falls within the current IST day. */
export function isAssignedToday(assignedAt: Date | null | undefined): boolean {
  if (!assignedAt) return false;
  const { start, end } = istDayRange();
  const t = new Date(assignedAt).getTime();
  return t >= start.getTime() && t < end.getTime();
}

/** Compose the fresh-lead state from the two independent signals. */
export function freshLeadState(assignedAt: Date | null | undefined, hasMeaningfulContact: boolean): FreshLeadState {
  const assignedToday = isAssignedToday(assignedAt);
  const firstContactPending = !hasMeaningfulContact;
  return { assignedToday, firstContactPending, isFresh: assignedToday && firstContactPending };
}

/** Does ONE activity row qualify as a meaningful first interaction? */
function isMeaningfulActivity(type: ActivityType, outcome: string | null, description: string | null, noteLen: number): boolean {
  if (type === ActivityType.CALL) return isConnectedOutcome(outcome);         // connected call only
  if (type === ActivityType.WHATSAPP) return true;                            // logged WA conversation
  if (MEETING_ACTIVITY_TYPES.includes(type)) return true;                     // meeting / site visit
  if (type === ActivityType.NOTE) return (description ?? "").trim().length >= noteLen; // substantial note
  return false; // EMAIL/TASK/STATUS_CHANGE/ASSIGNMENT/LEAD_CREATED/REMINDER/… are not a first contact
}

/**
 * Batch: which of these leads have already had a MEANINGFUL first interaction.
 * ONE query over Activity; the quality gates (connected / note length) are applied
 * in JS since they depend on outcome/description. Use for list surfaces.
 */
export async function meaningfulContactByLead(leadIds: string[], noteLen = DEFAULT_SUBSTANTIAL_NOTE_LEN): Promise<Set<string>> {
  const out = new Set<string>();
  if (leadIds.length === 0) return out;
  const rows = await prisma.activity.findMany({
    where: {
      leadId: { in: leadIds },
      type: { in: [ActivityType.CALL, ActivityType.WHATSAPP, ActivityType.NOTE, ...MEETING_ACTIVITY_TYPES] },
    },
    select: { leadId: true, type: true, outcome: true, description: true },
  });
  for (const r of rows) {
    if (out.has(r.leadId)) continue;
    if (isMeaningfulActivity(r.type, r.outcome, r.description, noteLen)) out.add(r.leadId);
  }
  return out;
}

/** Single-lead convenience (lead detail). */
export async function hasMeaningfulContact(leadId: string, noteLen = DEFAULT_SUBSTANTIAL_NOTE_LEN): Promise<boolean> {
  return (await meaningfulContactByLead([leadId], noteLen)).has(leadId);
}

/**
 * Full fresh-lead state for a SET of leads (list surfaces). Returns a map leadId →
 * FreshLeadState. One meaningful-contact query for the whole page.
 */
export async function freshLeadStateByLead(
  leads: { id: string; assignedAt: Date | null }[],
  noteLen = DEFAULT_SUBSTANTIAL_NOTE_LEN,
): Promise<Map<string, FreshLeadState>> {
  const contacted = await meaningfulContactByLead(leads.map((l) => l.id), noteLen);
  const map = new Map<string, FreshLeadState>();
  for (const l of leads) map.set(l.id, freshLeadState(l.assignedAt, contacted.has(l.id)));
  return map;
}

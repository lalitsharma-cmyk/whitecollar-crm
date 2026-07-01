// freshLeads — the SINGLE source of truth for "today's fresh / untouched leads".
//
// THE PROBLEM (Lalit, 2026-07-01)
//   Fresh leads assigned today get visually mixed with old follow-ups, so agents
//   miss them. There was no one definition of "fresh & untouched today" that the
//   Leads list, Dashboard, Action List, filters, reports, and the escalation cron
//   could all share — so each surface risked drifting.
//
// THE DEFINITIONS (one place, reused everywhere — never duplicate these):
//   • ASSIGNED TODAY   — the lead landed in THIS agent's queue today (IST). Keyed
//     off `assignedAt` (set whenever ownerId is (re)assigned). Legacy rows that
//     predate assignedAt fall back to `createdAt` so nothing is silently missed.
//   • FIRST CONTACT PENDING / "UNTOUCHED" — the agent has logged NOTHING yet: no
//     CallLog, and no contact-or-note Activity (call / WhatsApp / email / meeting /
//     site-visit / NOTE). This is a STATE, not a timer — so it clears the instant
//     the agent logs a call, WhatsApp, note, or (via the status change that those
//     actions imply) advances the lead. Mirrors dashboardWidgets.UNTOUCHED_WHERE
//     but ALSO counts a NOTE as first contact (Lalit's requirement 4).
//   • FRESH STATUS     — currentStatus is null/blank or an explicit fresh/new/
//     uncontacted value (isFreshStatus). A lead can be "assigned today" yet already
//     worked; "fresh" narrows to the not-yet-advanced ones.
//
// PURE MODULE — no prisma/auth/server-only import, so /leads, /master-data,
// leadFilterWhere, the reconciler, read-only scripts, and regression.ts can all
// import it. Callers own role/ownership scoping (spread leadScopeWhere(me)).
import type { Prisma } from "@prisma/client";
import { ActivityType } from "@prisma/client";
import { istDayRange } from "@/lib/datetime";
import { CONTACT_ACTIVITY_TYPES } from "@/lib/dashboardWidgets";
import { isFreshStatus, FRESH_STATUS_IN_VALUES, TERMINAL_STATUSES } from "@/lib/lead-statuses";

// Workable-status OR — status is null/blank or NOT a terminal (closed/lost) value.
// Defined locally (mirrors leadScope.WORKABLE_STATUS_OR) so this module stays off
// the server-only leadScope import chain, exactly like dashboardWidgets does.
const WORKABLE_STATUS_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];

// Fresh-status OR — the DB-expressible form of isFreshStatus() (Prisma can't call
// a function inside a where). Keeps the list and the runtime test in lock-step.
export const FRESH_STATUS_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { in: FRESH_STATUS_IN_VALUES } },
];

// The Activity types that count as "first contact made". A NOTE counts here
// (Lalit: a logged note = the agent has engaged the lead) even though it is NOT
// in dashboardWidgets.CONTACT_ACTIVITY_TYPES (that list is contact-channel only).
export const FIRST_CONTACT_ACTIVITY_TYPES: ActivityType[] = [
  ...CONTACT_ACTIVITY_TYPES,
  ActivityType.NOTE,
];

/** Prisma fragment: the lead has NO first contact logged (truly untouched).
 *  No CallLog at all, and no first-contact-type Activity. Composable — spread it
 *  as an AND element so its callLogs/activities keys never clobber a caller's. */
export const FIRST_CONTACT_PENDING_WHERE: Prisma.LeadWhereInput = {
  callLogs: { none: {} },
  activities: { none: { type: { in: FIRST_CONTACT_ACTIVITY_TYPES } } },
};

/** OR fragment: the lead was assigned today (IST), or — for legacy rows with no
 *  assignedAt — was created today. Pass as an AND element (it uses OR internally). */
export function assignedTodayOr(day?: Date): Prisma.LeadWhereInput {
  const { start, end } = istDayRange(day);
  return {
    OR: [
      { assignedAt: { gte: start, lt: end } },
      { assignedAt: null, createdAt: { gte: start, lt: end } },
    ],
  };
}

// Collision-safe compose: fold extra predicates into scope.AND, preserving any
// AND the caller already carries and never touching a caller's top-level OR.
function withAnd<T extends Prisma.LeadWhereInput>(
  scope: T,
  extra: Prisma.LeadWhereInput[],
): Prisma.LeadWhereInput {
  const existing = Array.isArray(scope.AND) ? scope.AND : scope.AND ? [scope.AND] : [];
  return { ...scope, AND: [...existing, ...extra] };
}

/** ASSIGNED TODAY — assigned today (IST) + workable. Any status, touched or not.
 *  Backs the "Assigned Today" filter chip. */
export function assignedTodayWhere<T extends Prisma.LeadWhereInput>(scope: T, day?: Date): Prisma.LeadWhereInput {
  return withAnd({ ...scope, deletedAt: null }, [assignedTodayOr(day), { OR: WORKABLE_STATUS_OR }]);
}

/** FRESH TODAY — assigned today (IST) + fresh status. The "Fresh Leads Today"
 *  count + the "Fresh Today" filter chip. */
export function freshTodayWhere<T extends Prisma.LeadWhereInput>(scope: T, day?: Date): Prisma.LeadWhereInput {
  return withAnd({ ...scope, deletedAt: null }, [assignedTodayOr(day), { OR: FRESH_STATUS_OR }]);
}

/** FRESH UNTOUCHED TODAY — assigned today (IST) + workable + no first contact yet.
 *  The "Untouched Fresh Leads" count, the "Fresh Untouched" chip, the tier-0 sort
 *  pin, and the escalation cron all key off THIS one definition. */
export function freshUntouchedWhere<T extends Prisma.LeadWhereInput>(scope: T, day?: Date): Prisma.LeadWhereInput {
  return withAnd({ ...scope, deletedAt: null }, [
    assignedTodayOr(day),
    { OR: WORKABLE_STATUS_OR },
    FIRST_CONTACT_PENDING_WHERE,
  ]);
}

/** FIRST CONTACT PENDING — any assigned, workable lead with no first contact yet
 *  (NOT limited to today). Surfaces the backlog of never-contacted owned leads —
 *  the ones most at risk of being forgotten. Backs the "First Contact Pending" chip. */
export function firstContactPendingWhere<T extends Prisma.LeadWhereInput>(scope: T): Prisma.LeadWhereInput {
  // ownerId not-null goes in the AND (NOT as a top-level key) so it never clobbers
  // a caller's own ownerId scope (e.g. { ownerId: agentId } for a per-agent count,
  // or an AGENT's leadScopeWhere) — a clobber would leak every agent's backlog.
  return withAnd({ ...scope, deletedAt: null }, [
    { ownerId: { not: null } },
    { OR: WORKABLE_STATUS_OR },
    FIRST_CONTACT_PENDING_WHERE,
  ]);
}

// ─── Per-row flags (for badges / row highlight / sort) ────────────────────────
export interface FreshRowInput {
  assignedAt?: Date | null;
  createdAt: Date;
  currentStatus?: string | null;
}

/** True when the lead was (re)assigned to its current owner today (IST), or — for
 *  legacy rows with no assignedAt — created today. Pure; safe on client + server. */
export function isAssignedToday(lead: FreshRowInput, day?: Date): boolean {
  const { start, end } = istDayRange(day);
  const ref = lead.assignedAt ?? lead.createdAt;
  return ref >= start && ref < end;
}

export interface FreshFlags {
  assignedToday: boolean;
  fresh: boolean;
  untouched: boolean;
  /** The headline state: assigned today AND no first contact — the tier-0 pin. */
  freshUntouchedToday: boolean;
}

/** Compute the badge/highlight flags for one lead row. `untouched` is supplied by
 *  the caller (a batch query over FIRST_CONTACT_PENDING_WHERE) so this stays pure. */
export function freshRowFlags(lead: FreshRowInput, untouched: boolean, day?: Date): FreshFlags {
  const assignedToday = isAssignedToday(lead, day);
  return {
    assignedToday,
    fresh: isFreshStatus(lead.currentStatus),
    untouched,
    freshUntouchedToday: assignedToday && untouched,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD WIDGET — canonical where-clauses (count == drill-down, single source).
//
// THE BUG THIS FIXES
//   A dashboard KPI card showed a number ("Hot Leads Untouched = 8") whose COUNT
//   query differed from the FILTER applied when the card was clicked (the drill
//   opened 0 leads). Root cause: the card count and the card's href were two
//   independently-written queries that drifted apart.
//
// THE RULE
//   For every widget there is ONE canonical `where` here. The dashboard card uses
//   it for BOTH (a) its count and (b) the params packed into its /leads href, so
//   the number shown == the rows that open on click == a direct prisma count.
//
// SCOPE (no contamination)
//   Every widget where is built from a personal/role scope that ALWAYS carries:
//     • ownerId = me.id            (agent: own book only — via the caller's scope)
//     • deletedAt: null            (recycle-bin leads never counted)
//     • isColdCall: false          (admin/cold/buyer-pool leads never counted)
//     • leadOrigin NOT IN COLD     (revival/cold origins live in the Revival Engine)
//   Managers/admins pass a team/owner scope instead of ownerId — same envelope.
//
// "UNTOUCHED" (Hot Leads Untouched — the redefinition)
//   Untouched = the lead has ZERO meaningful contact activity: no Call (CallLog or
//   a CALL Activity), no WhatsApp, no Email, no Meeting, no Site Visit logged. We
//   express that as: callLogs none AND activities none of the contact types. This
//   is a STATE, not a time threshold — so it never drifts from the drill-down.
// ────────────────────────────────────────────────────────────────────────────
import type { Prisma } from "@prisma/client";
import { AIScore, ActivityType } from "@prisma/client";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";

// Workable status OR — a lead is workable when its status is null/blank or NOT a
// terminal (closed/lost) status. Defined locally (mirrors leadScope.WORKABLE_STATUS_OR)
// so this module stays free of the server-only `leadScope` import chain and can be
// exercised by read-only scripts / the regression suite.
const WORKABLE_STATUS_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];

/** The Activity types that count as "meaningful contact" with a client.
 *  A lead with ANY of these (or any CallLog) is NOT "untouched". */
export const CONTACT_ACTIVITY_TYPES: ActivityType[] = [
  ActivityType.CALL,
  ActivityType.WHATSAPP,
  ActivityType.EMAIL,
  ActivityType.SITE_VISIT,
  ActivityType.OFFICE_MEETING,
  ActivityType.VIRTUAL_MEETING,
  ActivityType.HOME_VISIT,
  ActivityType.EXPO_MEETING,
  ActivityType.MEETING, // legacy meeting type
];

/** Prisma fragment: the lead has NO meaningful contact logged (truly untouched).
 *  No CallLog at all, and no contact-type Activity. Composable into any where. */
export const UNTOUCHED_WHERE: Prisma.LeadWhereInput = {
  callLogs: { none: {} },
  activities: { none: { type: { in: CONTACT_ACTIVITY_TYPES } } },
};

/**
 * HOT LEADS UNTOUCHED — canonical where.
 *
 *   scope (ownerId/team + deletedAt:null + isColdCall:false + non-cold origin)
 *   AND aiScore = HOT                         (the existing "hot signal")
 *   AND workable (not terminal — OR null/blank/non-terminal status)
 *   AND untouched (no contact/meeting/site-visit logged)
 *
 * Same object backs the dashboard count AND the /leads?ai=HOT&untouched=1 drill.
 */
export function hotUntouchedWhere(scope: Prisma.LeadWhereInput): Prisma.LeadWhereInput {
  return {
    ...scope,
    aiScore: AIScore.HOT,
    ...UNTOUCHED_WHERE,
    // Workable only — a booked/lost HOT lead is not an action item. Use AND so we
    // never clobber a caller's own OR.
    AND: [{ OR: WORKABLE_STATUS_OR }],
  };
}

/** The /leads URL params that reproduce hotUntouchedWhere for a given scope.
 *  The drill page applies the same scope (agent → own; admin → seg=mine). */
export const HOT_UNTOUCHED_PARAMS: Record<string, string> = {
  ai: "HOT",
  untouched: "1",
  followup: "all", // do NOT apply the /leads default "todue" follow-up narrowing
};

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

// ────────────────────────────────────────────────────────────────────────────
// DASHBOARD ACTIVITY AGGREGATION — fold Buyer-Data actions into the KPI counters.
//
// THE BUG THIS FIXES
//   The Dashboard's "Daily Performance" tiles only ever counted work done from the
//   Leads module: call counts read `CallLog` and activity counts read `Activity`
//   (which is lead-only — Activity.leadId is required). Actions performed inside
//   Dubai/India Buyer Data live in a SEPARATE ledger:
//     • buyer CALLS logged manually  → BuyerActivity{type:"CALL"} (NO CallLog row)
//     • buyer telephony CALLS        → CallLog{buyerId} + a mirrored BuyerActivity
//     • buyer WhatsApp / voice / notes / attempts → BuyerActivity rows only
//   So a call made or a note logged from Buyer Data never moved the dashboard.
//
// THE FIX (read-time aggregation — NO schema change, NO dual-write)
//   Widen ONLY the per-user activity metric queries to also read the buyer ledger:
//     • CALL counters  → count buyer calls from the buyer ledger, and read lead /
//       unlinked calls from CallLog. To keep each physical call counted EXACTLY
//       once we take buyer calls from ONE source only (see anti-double-count below).
//     • "Connected"    → connectedness is a CallLog.outcome concept; a manually
//       logged buyer "Call connected" has no outcome column, so it maps to a
//       BuyerActivity{type:"CALL"} — counted as a connected buyer call.
//
// ANTI-DOUBLE-COUNT (critical)
//   A telephony buyer call writes BOTH a CallLog{buyerId} AND a BuyerActivity CALL
//   for the SAME event. Counting both would double it. So the buyer CALL count is
//   sourced from the BuyerActivity ledger ONLY, and the CallLog side EXCLUDES
//   buyer-linked rows (buyerId:null). Net: every buyer call is counted once (from
//   BuyerActivity, whether it was manual or telephony), every lead / unlinked call
//   once (from CallLog). Lead-based counts are untouched.
//
// SCOPE MATCHING
//   All buyer counts carry the SAME envelope the lead counts use:
//     • userId = the acting agent   (attribute the work to who performed it)
//     • buyer.deletedAt = null      (recycle-bin buyers never counted)
//     • createdAt within the window (same IST day / date-range the tiles use)
//   Imported-remark BuyerActivity rows are userId:null with historical dates, so a
//   userId + window filter naturally excludes them — they never inflate "today".
// ────────────────────────────────────────────────────────────────────────────

/** BuyerActivity.type strings that represent a CALL the agent placed (manual
 *  "Call connected" + every attempt outcome). Mirrors buyerLifecycle's CALL +
 *  ATTEMPT_* vocabulary — kept as a literal list so this module stays free of the
 *  server-only buyerLifecycle import and can be exercised by read-only scripts. */
export const BUYER_CALL_ACTIVITY_TYPES: string[] = [
  "CALL",
  "ATTEMPT_NO_ANSWER",
  "ATTEMPT_NOT_PICKED",
  "ATTEMPT_WA_NO_RESPONSE",
];

/** BuyerActivity.type strings that count as a "connected" call (a real two-way
 *  conversation). Only the explicit CALL — the ATTEMPT_* types are, by definition,
 *  NOT connected. Parity with CallLog outcome = CONNECTED. */
export const BUYER_CONNECTED_ACTIVITY_TYPES: string[] = ["CALL"];

/** Minimal prisma surface this aggregation needs (buyerActivity.count). Accepts the
 *  real PrismaClient or a transaction client without dragging in a type dependency. */
type CountableBuyerActivity = {
  buyerActivity: {
    count: (args: {
      where: {
        userId?: string;
        type?: { in: string[] };
        createdAt?: { gte: Date; lt: Date };
        buyer?: { deletedAt: null };
      };
    }) => Promise<number>;
  };
};

/**
 * Count buyer-module CALLS performed by a user in a window (for the "Total Calls"
 * KPI). Sourced from the BuyerActivity ledger ONLY — see the anti-double-count note
 * above (the CallLog side must exclude buyer-linked rows). Includes attempts, since
 * a "no answer" / "not picked" attempt is still a call the agent placed.
 */
export function buyerCallsCount(
  db: CountableBuyerActivity,
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return db.buyerActivity.count({
    where: {
      userId,
      type: { in: BUYER_CALL_ACTIVITY_TYPES },
      createdAt: { gte: from, lt: to },
      buyer: { deletedAt: null },
    },
  });
}

/**
 * Count buyer-module CONNECTED calls performed by a user in a window (for the
 * "Connected Calls" KPI). Only explicit CALL rows — attempts are not connected.
 */
export function buyerConnectedCallsCount(
  db: CountableBuyerActivity,
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return db.buyerActivity.count({
    where: {
      userId,
      type: { in: BUYER_CONNECTED_ACTIVITY_TYPES },
      createdAt: { gte: from, lt: to },
      buyer: { deletedAt: null },
    },
  });
}

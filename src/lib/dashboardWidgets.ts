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
// ANTI-DOUBLE-COUNT (critical) — UPDATED 2026-07-18, SINGLE-SOURCE RULE
//   CallLog is now the ONE table every call in the CRM lives in. The buyer contact
//   flow writes a CallLog{buyerId} for every real phone call (src/lib/buyerLifecycle.ts)
//   in the same transaction as the BuyerActivity timeline row. So the SAME buyer call
//   now exists in BOTH tables, and counting both would DOUBLE it.
//   ⇒ Buyer calls are counted from CallLog (buyer-linked rows) ONLY.
//   ⇒ NEVER count buyer calls from BuyerActivity again.
//   The two sides stay disjoint by construction: lead-side call queries filter
//   `lead:{deletedAt:null}` (⇒ leadId not null) or `buyerId:null`, buyer-side queries
//   filter `buyer:{deletedAt:null}` (⇒ buyerId not null). Every call counted once.
//
// SCOPE MATCHING
//   All buyer counts carry the SAME envelope the lead counts use:
//     • userId = the acting agent   (attribute the work to who performed it)
//     • buyer.deletedAt = null      (recycle-bin buyers never counted)
//     • startedAt within the window (same IST day / date-range the tiles use;
//       the buyer CallLog row is stamped with the activity's own instant)
//   Imported-remark BuyerActivity rows are userId:null with historical dates and
//   write no CallLog at all, so they never inflate "today".
// ────────────────────────────────────────────────────────────────────────────

/** BuyerActivity.type strings that represent a CALL the agent placed (manual
 *  "Call connected" + every attempt outcome).
 *
 *  ⚠️ DEPRECATED as a CALL-COUNT source (2026-07-18). Buyer calls are counted from
 *  CallLog now — see the single-source rule above. These constants remain ONLY for
 *  the three report pages not yet migrated (/reports/ytd, /reports/team-comparison,
 *  /reports/leaderboard). Those pages are still safe because they add this
 *  BuyerActivity figure to a strictly LEAD-scoped CallLog figure, so nothing is
 *  double-counted — but they should be moved to CallLog for consistency, and until
 *  they are they will keep counting ATTEMPT_WA_NO_RESPONSE (which writes no CallLog)
 *  as a call. Do NOT use these in any NEW call count. */
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

/** CallLog.outcome values that count as a CONNECTED call. Mirrors
 *  CONNECTED_CALL_OUTCOMES in agentPerformance.ts and CONNECTED_OUTCOMES in
 *  callOutcome.ts, kept as literals so this module needs no @prisma/client import.
 *  The buyer contact flow maps a manual CALL → CONNECTED (see buyerLifecycle.ts). */
// NOT `as const`: Prisma's `outcome: { in: ... }` expects a MUTABLE CallOutcome[],
// and a readonly tuple would not be assignable to it.
export const BUYER_CONNECTED_CALL_OUTCOMES: Array<"CONNECTED" | "INTERESTED" | "NOT_INTERESTED"> = [
  "CONNECTED", "INTERESTED", "NOT_INTERESTED",
];

/** Minimal prisma surface these aggregations need (callLog.count). Accepts the
 *  real PrismaClient or a transaction client without dragging in a type dependency. */
type CountableCallLog = {
  callLog: {
    count: (args: {
      where: {
        userId?: string;
        startedAt?: { gte: Date; lt: Date };
        buyer?: { deletedAt: null };
        outcome?: { in: Array<"CONNECTED" | "INTERESTED" | "NOT_INTERESTED"> };
      };
    }) => Promise<number>;
  };
};

/**
 * Count buyer-module CALLS performed by a user in a window (for the "Total Calls"
 * KPI).
 *
 * SINGLE-SOURCE RULE (2026-07-18): sourced from CallLog (buyer-linked rows) — the
 * buyer contact flow now writes a CallLog row for every real phone call (see
 * src/lib/buyerLifecycle.ts). NEVER count buyer calls from BuyerActivity as well:
 * the same call exists in both tables now, so summing them would DOUBLE-COUNT.
 *
 * `buyer: { deletedAt: null }` requires the buyer relation to exist, so this counts
 * exactly the buyer-linked rows and excludes soft-deleted buyers — the mirror of the
 * lead-side `lead: { deletedAt: null }`. The two sets are disjoint, so a lead call
 * and a buyer call are each counted once. Includes attempts (a "not picked" attempt
 * is still a call the agent placed); ATTEMPT_WA_NO_RESPONSE is NOT a phone call and
 * writes no CallLog, so it is no longer counted here.
 */
export function buyerCallsCount(
  db: CountableCallLog,
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return db.callLog.count({
    where: {
      userId,
      startedAt: { gte: from, lt: to },
      buyer: { deletedAt: null },
    },
  });
}

/**
 * Count buyer-module CONNECTED calls performed by a user in a window (for the
 * "Connected Calls" KPI). Same single-source rule as buyerCallsCount — CallLog
 * only. Connected is decided by the call OUTCOME (the shared outcome set), not by
 * the activity type, so "connected" means the same thing for leads and buyers.
 */
export function buyerConnectedCallsCount(
  db: CountableCallLog,
  userId: string,
  from: Date,
  to: Date,
): Promise<number> {
  return db.callLog.count({
    where: {
      userId,
      startedAt: { gte: from, lt: to },
      buyer: { deletedAt: null },
      outcome: { in: BUYER_CONNECTED_CALL_OUTCOMES },
    },
  });
}

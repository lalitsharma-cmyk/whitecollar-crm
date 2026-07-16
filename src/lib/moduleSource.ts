// CANONICAL source_module — the ONE definition of "which module a record / activity
// belongs to", used by Global Search, Call Logs, Dashboard and Reports so the module
// label + bifurcation never drift between surfaces (Lalit, 2026-07-06).
//
// A customer record lives in exactly one module, derived from where it's stored:
//   • Lead.leadOrigin (+ isColdCall) → Leads | Master Data | Revival Engine
//   • BuyerRecord.market            → Dubai Buyer Data | India Buyer Data
// Activities inherit their record's module (Activity/CallLog by leadId → the lead's
// module; BuyerActivity/CallLog by buyerId → the buyer's module). PURE module (no
// prisma / server-only) so client components + the read-time aggregation both use it.
// Origin sets mirror leadScope.COLD_ORIGINS / MASTER_DATA_ORIGINS (regression locks it).

export type SourceModule =
  | "Leads"
  | "Master Data"
  | "Revival Engine"
  | "Dubai Buyer Data"
  | "India Buyer Data";

/** Lead-based module ordering (the 3 lead origins) + buyer modules, for report/tab order. */
export const LEAD_SOURCE_MODULES: SourceModule[] = ["Leads", "Master Data", "Revival Engine"];
export const BUYER_SOURCE_MODULES: SourceModule[] = ["Dubai Buyer Data", "India Buyer Data"];
export const ALL_SOURCE_MODULES: SourceModule[] = [...LEAD_SOURCE_MODULES, ...BUYER_SOURCE_MODULES];

const COLD_ORIGINS = ["COLD", "REVIVAL"];
const MASTER_DATA_ORIGINS = ["MASTER_DATA", "PORTFOLIO", "SYSTEM"];

/** The module a LEAD row belongs to. */
export function leadSourceModule(leadOrigin: string | null | undefined, isColdCall?: boolean | null): SourceModule {
  if ((leadOrigin && COLD_ORIGINS.includes(leadOrigin)) || isColdCall) return "Revival Engine";
  if (leadOrigin && MASTER_DATA_ORIGINS.includes(leadOrigin)) return "Master Data";
  return "Leads";
}

/** The module a BUYER row belongs to. */
export function buyerSourceModule(market: string | null | undefined): SourceModule {
  return market === "India" ? "India Buyer Data" : "Dubai Buyer Data";
}

// ── ACTIVITY (call / note / WhatsApp / meeting) source module ─────────────────
// An activity is something an AGENT DID, so its module = the WORKING SURFACE the
// agent acted from, NOT the passive classification of the record. Agents work only
// from the Leads queue, the Revival Engine, or Buyer Data — they have NO Master Data
// calling/logging UI (Master Data is a read-only admin archive). So an activity is
// NEVER "Master Data": a call/note on a master-origin lead is attributed to "Leads"
// (that's the queue the agent worked it from). This is the rule behind "calls must
// never show Master Data" for Call Logs / Daily Performance / Agent Performance
// (Lalit 2026-07-08). Records still classify via leadSourceModule (Master Data is a
// valid RECORD bucket) — only ACTIVITY attribution collapses it.

/** The 4 modules an ACTIVITY can be performed from (no Master Data). Display order
 *  for the Call-Logs module filter + any per-module call breakdown. */
export const ACTIVITY_SOURCE_MODULES: SourceModule[] = [
  "Leads", "Revival Engine", "Dubai Buyer Data", "India Buyer Data",
];

/** The module a LEAD-linked ACTIVITY (call/note/WhatsApp/meeting) was performed
 *  from. Revival when the lead is cold/revival; otherwise "Leads" — master-origin
 *  leads included, because the agent works them from the Leads queue. NEVER returns
 *  "Master Data" (unlike leadSourceModule). */
export function activityLeadModule(leadOrigin: string | null | undefined, isColdCall?: boolean | null): SourceModule {
  if ((leadOrigin && COLD_ORIGINS.includes(leadOrigin)) || isColdCall) return "Revival Engine";
  return "Leads";
}

/** True when a module is one of the two Buyer-Data modules (vs the 3 lead modules). */
export function isBuyerModule(m: SourceModule): boolean {
  return m === "Dubai Buyer Data" || m === "India Buyer Data";
}

// ── Revival Engine = calling-only (Lalit, 2026-07-16) ─────────────────────────
// Active-pipeline activity kinds may NOT be CREATED on a cold/revival-origin
// lead — via UI, API, or any hidden route. Convert the record to a Lead first.
// Existing historical rows are never deleted and stay readable; server guards
// 403 the WRITE paths only. Typed readonly string[] so `.includes()` accepts a
// Prisma ActivityType without importing @prisma/client (this module stays PURE).

/** The 6 activity types blocked from creation on Revival-Engine leads. */
export const REVIVAL_BLOCKED_ACTIVITY_TYPES: readonly string[] = [
  "OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT", "HOME_VISIT", "EXPO_MEETING", "MEETING",
];

/** The one 403 body every guarded creator returns for a revival-origin lead. */
export const REVIVAL_CALLING_ONLY_ERROR =
  "Meetings, site visits, expos and home visits aren't available in Revival Engine — convert this record to a Lead first.";

/** True when a lead lives in the Revival Engine (leadOrigin COLD or REVIVAL). */
export function isRevivalOrigin(leadOrigin: string | null | undefined): boolean {
  return !!leadOrigin && COLD_ORIGINS.includes(leadOrigin);
}

/** The detail-page href for a record, by module + id. Leads/Master/Revival share the
 *  lead detail; buyers open their market's buyer detail. */
export function moduleHref(module: SourceModule, id: string): string {
  // BOTH buyer markets open the market-agnostic /buyer-data/[id] detail — there is
  // NO /india-buyer-data/[id] route (the India list links to /buyer-data/[id] too).
  if (module === "India Buyer Data" || module === "Dubai Buyer Data") return `/buyer-data/${id}`;
  return `/leads/${id}`;
}

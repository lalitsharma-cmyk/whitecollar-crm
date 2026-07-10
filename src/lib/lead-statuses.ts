// Excel/MIS Status values used by White Collar Realty.
//
// TWO SEPARATE STATUS MASTERS — India team and Dubai team have completely
// different sales workflows. Status dropdowns change dynamically based on
// the lead's forwardedTeam. No combined list is shown anywhere.
//
// STATUS IS THE ONLY WORKFLOW. No stage system. No won/lost/open grouping.

// isWebsiteSource lives in lead-sources.ts (a leaf module with NO imports), so
// importing it here can't create a cycle. It backs the "Website Lead today" sort
// tier. lead.source is the LeadSource ENUM (stored as its KEY: "WEBSITE",
// "WCR_WEBSITE", "LANDING_PAGE"), so we match keys, not display labels.
import { isWebsiteSource } from "@/lib/lead-sources";

// ─── India Team Status Master ────────────────────────────────────────────────
export const INDIA_STATUSES = [
  // Active pursuit
  "Fresh Lead",
  "Follow Up",
  "Not Contacted",
  "Never Contacted",
  "Details Shared",
  // Visits / Meetings
  "Site Visit Schedule",
  "Meeting",
  // Evaluating
  "Never Responding",
  // Location / Requirement
  "Other Location",
  "Other Requirement",
  "Commercial",
  "Resale",
  // Obstacles
  "Low Budget",
  "Funds Issue",
  "Postponed",
  "Just Searching",
  // Competitor / Broker
  "Broker",
  "In Touch With Another Broker",
  // Dead / Lost
  "Not Interested",
  "Drop The Plan",
  "Blocked Me",
  "Already Booked",
  "Sell Off",
  "Number Changed",
  "Invalid Number",
  "Junk",
] as const;

// ─── Dubai Team Status Master ─────────────────────────────────────────────────
export const DUBAI_STATUSES = [
  // Active pursuit
  "Fresh Lead",
  "Follow Up",
  "Long Term Follow Up",
  "Mail Sent",
  // Meetings / Visits
  "Visit Dubai",
  "Wants Office Visit",
  "Zoom Meeting",
  "Meeting",
  "Expo Only",
  // Obstacles
  "War Fear",
  "Funds Issue",
  "Not Able To Buy",
  // Competitor / Broker
  "Broker",
  "Visited With Other Broker",
  // Won
  "Booked With Us",
  // Sold / rented
  "Sell Out",
  "Leasing",
  "Rent Out",
  // Specialised
  "Commercial Investment",
  "Already Bought",
  // Location
  "Other Location",
  "Other Requirement",
  // Dead
  "Number Changed",
  "Never Respond Phone Calls",
  "Pass Away",
] as const;

export type IndiaStatus = (typeof INDIA_STATUSES)[number];
export type DubaiStatus = (typeof DUBAI_STATUSES)[number];

/**
 * Returns the correct status list for a given team.
 * null/unclassified → combined list so the agent can still set a status.
 */
export function statusesForTeam(team: string | null | undefined): readonly string[] {
  if (team === "India") return INDIA_STATUSES;
  if (team === "Dubai") return DUBAI_STATUSES;
  // Unclassified lead — show union so agent can always act
  return ALL_STATUSES;
}

// ─── Legacy combined list (kept for backward-compat imports + unclassified leads) ─
export const EXCEL_STATUSES = [
  ...new Set([...INDIA_STATUSES, ...DUBAI_STATUSES]),
] as unknown as readonly string[];

// Full union — used for unclassified leads and global filters
const ALL_STATUSES: readonly string[] = EXCEL_STATUSES;

export type ExcelStatus = string;

// ─── Reminder suppression ─────────────────────────────────────────────────────
// Cron jobs skip leads whose currentStatus is in this list.
// Covers both India and Dubai dead-end statuses.
export const SUPPRESSED_STATUSES: string[] = [
  // Both teams
  "Junk",
  "Invalid Number",
  "Number Changed",
  // Dubai
  "Pass Away",
  // India
  "Blocked Me",
  "Drop The Plan",
  "By Mistake Inquiry", // legacy
];

export function isReminderSuppressed(status: string | null | undefined): boolean {
  if (!status) return false;
  return SUPPRESSED_STATUSES.includes(status);
}

// ─── Budget minimum presets ───────────────────────────────────────────────────
export const BUDGET_PRESETS: Array<{ key: string; value: number; label: string }> = [
  { key: "50l_inr",  value: 5_000_000,   label: "₹ 50L+" },
  { key: "1cr_inr",  value: 10_000_000,  label: "₹ 1Cr+" },
  { key: "3cr_inr",  value: 30_000_000,  label: "₹ 3Cr+" },
  { key: "5cr_inr",  value: 50_000_000,  label: "₹ 5Cr+" },
  { key: "10cr_inr", value: 100_000_000, label: "₹ 10Cr+" },
  { key: "1m_aed",   value: 1_000_000,   label: "AED 1M+" },
  { key: "2m_aed",   value: 2_000_000,   label: "AED 2M+" },
  { key: "5m_aed",   value: 5_000_000,   label: "AED 5M+" },
  { key: "10m_aed",  value: 10_000_000,  label: "AED 10M+" },
];

// ─── Per-status color classes ─────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  // ── Shared / common ──────────────────────────────────────────────────────
  "Fresh Lead":             "bg-blue-100 text-blue-700 border border-blue-200",
  "Follow Up":              "bg-orange-100 text-orange-700 border border-orange-200",
  "Meeting":                "bg-teal-100 text-teal-700 border border-teal-200",
  "Funds Issue":            "bg-amber-100 text-amber-700 border border-amber-200",
  "Broker":                 "bg-slate-100 text-slate-500 border border-slate-200",
  "Other Location":         "bg-gray-100 text-gray-600 border border-gray-200",
  "Other Requirement":      "bg-gray-100 text-gray-600 border border-gray-200",
  "Number Changed":         "bg-slate-100 text-slate-400 border border-slate-200",
  // ── India ─────────────────────────────────────────────────────────────────
  "Not Contacted":          "bg-slate-100 text-slate-600 border border-slate-200",
  "Never Contacted":        "bg-slate-100 text-slate-500 border border-slate-200",
  "Details Shared":         "bg-sky-100 text-sky-700 border border-sky-200",
  "Site Visit Schedule":    "bg-teal-100 text-teal-700 border border-teal-200",
  "Never Responding":       "bg-slate-100 text-slate-500 border border-slate-200",
  "Commercial":             "bg-violet-100 text-violet-700 border border-violet-200",
  "Resale":                 "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Low Budget":             "bg-red-100 text-red-600 border border-red-200",
  "Postponed":              "bg-amber-100 text-amber-600 border border-amber-200",
  "Just Searching":         "bg-slate-100 text-slate-500 border border-slate-200",
  "In Touch With Another Broker": "bg-rose-100 text-rose-600 border border-rose-200",
  "Not Interested":         "bg-red-100 text-red-700 border border-red-200",
  "Drop The Plan":          "bg-slate-100 text-slate-500 border border-slate-200",
  "Blocked Me":             "bg-red-100 text-red-800 border border-red-200",
  "Already Booked":         "bg-green-100 text-green-800 border border-green-200",
  "Sell Off":               "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Invalid Number":         "bg-slate-100 text-slate-400 border border-slate-200",
  "Junk":                   "bg-slate-100 text-slate-400 border border-slate-200",
  // ── Dubai ─────────────────────────────────────────────────────────────────
  "Long Term Follow Up":    "bg-purple-100 text-purple-700 border border-purple-200",
  "Mail Sent":              "bg-indigo-100 text-indigo-700 border border-indigo-200",
  "Visit Dubai":            "bg-teal-100 text-teal-700 border border-teal-200",
  "Wants Office Visit":     "bg-teal-100 text-teal-700 border border-teal-200",
  "Want Office Visit":      "bg-teal-100 text-teal-700 border border-teal-200", // legacy
  "Zoom Meeting":           "bg-teal-100 text-teal-700 border border-teal-200",
  "Expo Only":              "bg-cyan-100 text-cyan-700 border border-cyan-200",
  "War Fear":               "bg-amber-100 text-amber-800 border border-amber-200",
  "Not Able To Buy":        "bg-slate-100 text-slate-500 border border-slate-200",
  "Visited With Other Broker": "bg-rose-100 text-rose-700 border border-rose-200",
  "Booked With Us":         "bg-green-100 text-green-800 border border-green-200 font-semibold",
  "Booked with Us":         "bg-green-100 text-green-800 border border-green-200 font-semibold", // legacy
  "Sell Out":               "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Leasing":                "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Rent Out":               "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Commercial Investment":  "bg-violet-100 text-violet-700 border border-violet-200",
  "Already Bought":         "bg-rose-100 text-rose-700 border border-rose-200",
  "Never Respond Phone Calls": "bg-slate-100 text-slate-500 border border-slate-200",
  "Pass Away":              "bg-slate-100 text-slate-400 border border-slate-200",
  // ── Closed-elsewhere outcomes (replace the old "Booked With Us" reject) ───
  "Purchased Elsewhere":          "bg-rose-100 text-rose-700 border border-rose-200",
  "Booked Through Another Channel": "bg-rose-100 text-rose-700 border border-rose-200",
  // ── Needs Review (team-status revalidation sentinel) ──────────────────────
  "Needs Review":           "bg-yellow-100 text-yellow-800 border border-yellow-300 font-semibold",
  // ── Legacy (old names, still in DB from previous imports) ─────────────────
  "By Mistake Inquiry":     "bg-slate-100 text-slate-400 border border-slate-200",
  "Gurgaon":                "bg-gray-100 text-gray-600 border border-gray-200",
  "Repeated":               "bg-slate-100 text-slate-500 border border-slate-200",
};

const FALLBACK_COLOR = "bg-slate-100 text-slate-600 border border-slate-200";

/** Returns Tailwind chip classes for a given currentStatus value. */
export function statusColor(s: string | null | undefined): string {
  if (!s) return FALLBACK_COLOR;
  return STATUS_COLORS[s] ?? FALLBACK_COLOR;
}

/** @deprecated Use statusColor() */
export function excelStatusChip(s: string | null): string {
  return statusColor(s);
}

// ─── Booking / WON definition (the SINGLE source of truth for "won") ────────
// Both DB casings: "Booked With Us" (Dubai master, canonical) + "Booked with Us"
// (legacy import). A query matching only ONE casing silently undercounts, so
// every "deals closed / won / bookings" KPI MUST filter on this list (or call
// isBookedStatus). Deliberately NARROWER than CLOSED_OUTCOME_STATUSES — that
// list also covers resale / lease / bought-elsewhere outcomes which are NOT a
// booking and must never inflate a win count.
export const BOOKED_STATUSES: string[] = ["Booked With Us", "Booked with Us"];
export function isBookedStatus(currentStatus: string | null | undefined): boolean {
  return currentStatus != null && BOOKED_STATUSES.includes(currentStatus);
}

// ─── Active-pursuit statuses ──────────────────────────────────────────────
export const INDIA_ACTIVE_STATUSES: string[] = [
  "Fresh Lead", "Follow Up", "Not Contacted", "Never Contacted",
  "Details Shared", "Site Visit Schedule", "Meeting",
  "Never Responding", "Postponed",
  // "Funds Issue" is deliberately NOT here — Lalit 2026-07-06: Funds Issue = LOST
  // category (reported under Lost, never Active). It lives ONLY in LOST_STATUSES.
];

export const DUBAI_ACTIVE_STATUSES: string[] = [
  "Fresh Lead", "Follow Up", "Long Term Follow Up", "Mail Sent",
  "Visit Dubai", "Wants Office Visit", "Want Office Visit",
  "Zoom Meeting", "Meeting", "Expo Only", "War Fear",
  // "Funds Issue" removed — LOST category only (Lalit 2026-07-06). See LOST_STATUSES.
];

export const ACTIVE_PURSUIT_STATUSES: string[] = [
  ...new Set([...INDIA_ACTIVE_STATUSES, ...DUBAI_ACTIVE_STATUSES]),
];

// ─── Closing statuses (manager-review flagging) ───────────────────────────
export const CLOSING_STATUSES: string[] = [
  // India
  "Site Visit Schedule", "Meeting",
  // Dubai
  "Wants Office Visit", "Want Office Visit", "Zoom Meeting",
  "Visit Dubai", "Expo Only",
  "Booked With Us", "Booked with Us",
];

// ─── Lead lifecycle category: WORKABLE / CLOSED / LOST ────────────────────
// SINGLE SOURCE OF TRUTH for "is this lead still workable?". Both LOST (rejected/
// dead) and CLOSED (booked/sold/leased) statuses are TERMINAL — they leave the
// normal working Leads view and live in Master Data. Everything else (incl. null,
// unknown, Fresh Lead) is WORKABLE — fail-safe so a new or mis-typed status never
// silently hides a lead from the team.
//
// Driven by the Reject-modal reasons (reject-reasons.ts) so the working Leads
// view, the agent reject flow, imports, and Master Data all agree. Lalit's rule:
//   "Normal Leads = only leads that can be worked on."

// Closed outcomes — the DEAL IS DONE (booked / sold / leased). NOT a rejection.
export const CLOSED_OUTCOME_STATUSES: string[] = [
  "Booked With Us", "Booked with Us",   // legacy casing — booked WITH US (the win)
  "Sell Out", "Sell Off",               // Sell Off = India legacy of Sell Out
  "Leasing", "Rent Out",
  "Already Bought", "Already Booked",    // Already Booked = India legacy
  "Commercial Investment",
  // Client completed a deal ELSEWHERE (not with us) — a real, non-junk outcome.
  // Replaces the old "Booked With Us" reject reason, which wrongly inflated wins.
  "Purchased Elsewhere", "Booked Through Another Channel",
];

// ─── Sale Off / Lease Off module registries (single source) ────────────────
// Leads in these (terminal) statuses are the SELLER / re-sale / rental inventory.
// They're excluded from the working /leads view and instead surface in their own
// Sale Off / Lease Off modules. Add a new sell/lease status here ONCE and it
// auto-appears in the module (Lalit 2026-07-02). India "Sell Off" + Dubai "Sell Out".
export const SALE_OFF_STATUSES: string[] = ["Sell Out", "Sell Off"];
export const LEASE_OFF_STATUSES: string[] = ["Leasing", "Rent Out"];

// Lost / rejected — non-actionable. Sourced from the Reject modal (minus the
// closed outcomes) plus the dead-end suppressed statuses + India equivalents.
export const LOST_STATUSES: string[] = [
  "Not Interested", "War Fear", "Funds Issue", "Not Able To Buy",
  "Broker", "Visited With Other Broker", "In Touch With Another Broker",
  "Other Location", "Other Requirement", "Low Budget", "Just Searching",
  "Drop The Plan", "Number Changed", "Invalid Number",
  "Never Respond Phone Calls", "Never Respond Phone calls", // import casing variant
  "Never Responding", "Pass Away",
  "Junk", "Blocked Me", "By Mistake Inquiry",
  // Bare "Other" = the OTHER reject-reason outcome (rejectionStatusFor("OTHER")).
  // Only ever set on a rejected lead, so it's terminal — it must leave the working
  // view. (Verified: 0 active/non-rejected leads carry it. Lalit 2026-06-28.)
  "Other",
  // Import-safety terminals (Lalit 2026-07-10). No CRM picker produces these and 0 prod
  // leads carry them — they exist so that a CSV / Google-Sheet / API import carrying one
  // is classified terminal on arrival and therefore lands UNASSIGNED with no follow-up,
  // instead of slipping in as a workable lead. isStatusValidForTeam() passes every
  // terminal for any team, so these survive import intact rather than becoming
  // "Needs Review". LOST_STATUSES is a classification list only (never a picker).
  "Lost", "Rejected", "Duplicate", "Out of Scope",
];

// Every terminal status — both CLOSED and LOST leave the working Leads view.
export const TERMINAL_STATUSES: string[] = [
  ...CLOSED_OUTCOME_STATUSES,
  ...LOST_STATUSES,
];

// True when a status is TERMINAL (booked/sold/leased OR lost/rejected). A lead in
// a terminal status is done — it must NOT keep an active followupDate (that would
// surface it on the Action-List follow-up board, which applies no status filter).
// Every status-change path that can set a terminal value (reject flow, inline
// /update) clears followupDate + followupReminderSentAt when this is true.
export function isTerminalStatus(status: string | null | undefined): boolean {
  return status != null && TERMINAL_STATUSES.includes(status);
}

// ─── Dashboard live-status COLUMN buckets (admin assignment widget) ───────
// SINGLE SOURCE OF TRUTH for the admin-dashboard "Live Lead Assignment" grid,
// which breaks a population of leads down by CURRENT status into one column
// each. Buckets are DISJOINT — every lead lands in exactly one — so the column
// counts always sum to the population (no double-count, perfect reconciliation).
//
// The CRM has NO explicit "Contacted/Qualified/Negotiation" status; those
// columns map from the real MIS vocabulary below (NOT hardcoded at the call
// site). Precedence top→bottom; first match wins:
//   BOOKED  → a win (isBookedStatus)                  — terminal
//   LOST    → any LOST_STATUS                          — terminal
//   MEETING → reached a meeting/office/zoom stage
//   SITE_VISIT → a physical-visit stage
//   NEGOTIATION → "in discussion" (details/mail shared)
//   QUALIFIED → engaged & advanced past first contact, pre-meeting
//   CONTACTED → worked / in active follow-up conversation
//   FRESH   → isFreshStatus (untouched / new / not-contacted / null)
//   OTHER   → closed-but-not-a-win (sell/lease/bought-elsewhere) + anything else
// FRESH..NEGOTIATION + OTHER are all WORKABLE/"active"; BOOKED+LOST are terminal.
export type LeadStatusColumn =
  | "FRESH" | "CONTACTED" | "QUALIFIED" | "MEETING" | "SITE_VISIT"
  | "NEGOTIATION" | "BOOKED" | "LOST" | "OTHER";

// Meeting-stage statuses (office / zoom / expo / generic meeting).
const COL_MEETING_STATUSES = [
  "Meeting", "Wants Office Visit", "Want Office Visit", "Zoom Meeting", "Expo Only",
];
// Physical site-visit stage.
const COL_SITE_VISIT_STATUSES = ["Site Visit Schedule", "Visit Dubai"];
// "In discussion / negotiation" proxy — collateral shared, evaluating a deal.
const COL_NEGOTIATION_STATUSES = ["Details Shared", "Mail Sent"];
// Advanced-but-pre-meeting engaged statuses → "Qualified".
const COL_QUALIFIED_STATUSES = ["Long Term Follow Up"];
// Worked / actively-followed-up conversation → "Contacted". (NOT "Never
// Responding" — that's a LOST dead-end, classified as LOST by precedence; kept
// out of this finite set so the buckets stay strictly disjoint.)
const COL_CONTACTED_STATUSES = ["Follow Up", "Postponed"];

const COL_MEETING_SET = new Set(COL_MEETING_STATUSES);
const COL_SITE_VISIT_SET = new Set(COL_SITE_VISIT_STATUSES);
const COL_NEGOTIATION_SET = new Set(COL_NEGOTIATION_STATUSES);
const COL_QUALIFIED_SET = new Set(COL_QUALIFIED_STATUSES);
const COL_CONTACTED_SET = new Set(COL_CONTACTED_STATUSES);

/** Classify a CURRENT status into exactly one dashboard column bucket. */
export function leadStatusColumn(status: string | null | undefined): LeadStatusColumn {
  if (isBookedStatus(status)) return "BOOKED";
  if (status && LOST_STATUSES.includes(status)) return "LOST";
  if (status && COL_MEETING_SET.has(status)) return "MEETING";
  if (status && COL_SITE_VISIT_SET.has(status)) return "SITE_VISIT";
  if (status && COL_NEGOTIATION_SET.has(status)) return "NEGOTIATION";
  if (status && COL_QUALIFIED_SET.has(status)) return "QUALIFIED";
  if (status && COL_CONTACTED_SET.has(status)) return "CONTACTED";
  if (isFreshStatus(status)) return "FRESH";
  return "OTHER"; // closed-non-win (sell/lease/bought-elsewhere) or unmapped
}

/** Exact status string set behind each column (for Prisma `in` drill-down).
 *  FRESH / OTHER are open-ended (null / negation) so they have no finite list
 *  and get their own where-fragments at the call site. */
export const COLUMN_STATUS_VALUES: Partial<Record<LeadStatusColumn, string[]>> = {
  MEETING: COL_MEETING_STATUSES,
  SITE_VISIT: COL_SITE_VISIT_STATUSES,
  NEGOTIATION: COL_NEGOTIATION_STATUSES,
  QUALIFIED: COL_QUALIFIED_STATUSES,
  CONTACTED: COL_CONTACTED_STATUSES,
  BOOKED: BOOKED_STATUSES,
  LOST: LOST_STATUSES,
};
// Statuses that ARE finitely-listed in a column (everything except FRESH/OTHER).
// FRESH = isFreshStatus; OTHER = "assigned, not in any of the above" — used to
// build the negation where-fragment so FRESH+OTHER+listed == population.
export const COLUMN_NON_OPEN_STATUSES: string[] = [
  ...COL_MEETING_STATUSES, ...COL_SITE_VISIT_STATUSES, ...COL_NEGOTIATION_STATUSES,
  ...COL_QUALIFIED_STATUSES, ...COL_CONTACTED_STATUSES, ...BOOKED_STATUSES, ...LOST_STATUSES,
];
// Explicit fresh-status casings (mirrors isFreshStatus) for a Prisma `in`
// drill-down clause — Prisma can't call isFreshStatus inside a where.
export const FRESH_STATUS_IN_VALUES: string[] = [
  "Fresh Lead", "Fresh", "New", "New Lead", "Not Contacted", "Never Contacted",
  "Uncontacted", "Not Connected Yet",
];

// ─── "Needs Review" sentinel (team-status revalidation) ───────────────────
// When a lead's team changes — or an import brings a status that doesn't exist
// in the lead's team master — we MUST NOT force a wrong-team status. We set this
// sentinel instead, so a human re-picks the correct team status. It's valid for
// every team, displayed with a distinct chip, and stays WORKABLE (leadCategory →
// WORKABLE) so the lead surfaces for correction rather than hiding.
export const NEEDS_REVIEW = "Needs Review";

/**
 * Is `status` allowed for `team`? True when it's in that team's master, OR a
 * team-agnostic terminal outcome (a booked/lost lead shouldn't be re-flagged on
 * a team move), OR the Needs-Review sentinel, OR there's no status yet. Used by
 * team-change + import to decide whether to keep the status or flag it.
 */
export function isStatusValidForTeam(status: string | null | undefined, team: string | null | undefined): boolean {
  if (!status) return true;
  if (status === NEEDS_REVIEW) return true;
  if (TERMINAL_STATUSES.includes(status)) return true;
  return (statusesForTeam(team) as readonly string[]).includes(status);
}

export type LeadCategory = "WORKABLE" | "CLOSED" | "LOST";

/** Classify a lead by its currentStatus. null/unknown → WORKABLE (fail-safe). */
export function leadCategory(status: string | null | undefined): LeadCategory {
  if (status && CLOSED_OUTCOME_STATUSES.includes(status)) return "CLOSED";
  if (status && LOST_STATUSES.includes(status)) return "LOST";
  return "WORKABLE";
}

/** True when the lead is still actionable (belongs in the normal Leads view). */
export function isWorkableStatus(status: string | null | undefined): boolean {
  return leadCategory(status) === "WORKABLE";
}

// ─── Canonical status casing (import normalization) ───────────────────────
// Excel sheets carry inconsistent casing ("Never Respond Phone calls",
// "mail sent"). Imports must map any incoming status to the CANONICAL label so
// the working-view terminal/workable classification — which is an exact match —
// never leaks. Unknown statuses are preserved (trimmed) so new values aren't
// silently dropped.
// Build proper-casing-FIRST so a defensive lowercase variant (e.g. the
// "Never Respond Phone calls" kept in LOST_STATUSES for the runtime exact-match
// filter) can never become the canonical target. The team masters carry the
// authoritative casing, so they win key collisions.
const CANONICAL_STATUS_BY_KEY: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const s of [...DUBAI_STATUSES, ...INDIA_STATUSES, ...CLOSED_OUTCOME_STATUSES, ...LOST_STATUSES]) {
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (!m.has(key)) m.set(key, s);
  }
  return m;
})();

// Explicit ALIASES — sheet/import variants that the master-derived map can't fold
// because they differ by more than casing (a missing/extra word, "Fund" vs
// "Funds", a hyphen). Each LHS (normalized: lowercased, single-spaced, trimmed)
// maps to a value that EXISTS in a team master, so the folded lead lands under one
// canonical chip + inside the team status dropdown. Keys are pre-normalized.
//   "Long Term Followup" / "Long-term Followup" / "Long Follow Up" → "Long Term Follow Up"
//   "Fund Issue" → "Funds Issue"  (+ "Funds Issues" plural slip)
// (Bare "Other" is deliberately NOT aliased — it has no unambiguous canonical
//  target; forcing "Other Location"/"Other Requirement" would fabricate intent.)
const CANONICAL_STATUS_ALIASES: Record<string, string> = {
  "long term followup": "Long Term Follow Up",
  "long-term followup": "Long Term Follow Up",
  "long term follow up": "Long Term Follow Up",
  "long follow up": "Long Term Follow Up",
  "longterm followup": "Long Term Follow Up",
  "fund issue": "Funds Issue",
  "funds issues": "Funds Issue",
  "fund issues": "Funds Issue",
};

export function canonicalStatus(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const key = trimmed.toLowerCase().replace(/\s+/g, " ").trim();
  // Explicit aliases first (handles word/spelling variants), then the
  // master-derived casing map, else preserve the trimmed original.
  return CANONICAL_STATUS_ALIASES[key] ?? CANONICAL_STATUS_BY_KEY.get(key) ?? trimmed;
}

// A lead is "fresh" when it has not yet been worked: no real status yet, or an
// explicit fresh/new/uncontacted status. Keys off currentStatus (the real MIS
// status) — NOT the vestigial `status` enum which rarely advances past NEW.
export function isFreshStatus(s: string | null | undefined): boolean {
  if (s == null) return true;
  const t = s.trim().toLowerCase();
  if (t === "") return true;
  return t === "fresh lead" || t === "fresh" || t === "new" || t === "new lead"
    || t === "not contacted" || t === "never contacted" || t === "uncontacted" || t === "not connected yet";
}

/**
 * Default Leads-table priority tier (Lalit, 2026-07-06 — new "Fresh-Lead priority").
 * Lower = higher on the list. FIRST MATCH WINS; tier 0 = the very top. Today's brand
 * new leads always sit above old follow-ups, ordered so the freshest/hottest inbound
 * (a fresh website lead created today) outranks everything.
 *
 *   0 FRESH LEAD created today   — active-pipeline, createdAt today (IST), fresh status
 *   1 WEBSITE LEAD today         — active-pipeline, createdAt today, source is a website source
 *   2 MANUALLY created today     — active-pipeline, createdAt today (anything created today not above)
 *   3 ASSIGNED today             — active-pipeline, assigned today (assignedToday flag)
 *   4 UNTOUCHED                  — no first contact ever logged (any age)
 *   5 FOLLOW-UP due today        — followupDate within today IST      ┐ EXISTING tiers,
 *   6 FRESH status (any)         — isFreshStatus                       │ preserved 1:1
 *   7 OVERDUE follow-up          — followupDate before today IST       │ (were tiers 2-6
 *   8 FUTURE follow-up           — followupDate >= tomorrow IST        │  pre-2026-07-06).
 *   9 everything else                                                  ┘
 *
 * Tiers 0-3 REQUIRE the lead to be in the active Leads pipeline (a NEW website/API/
 * manual entry, not Master Data / Buyer / Revival / a bulk import). `activePipeline`
 * comes from the caller (freshLeads.isActivePipelineRow) so this module never imports
 * freshLeads (which imports THIS module — a cycle). It defaults to TRUE when the flag
 * is omitted, preserving back-compat for any caller that can't supply origin.
 *
 * The other signals are ALSO caller-supplied precomputed flags for the same
 * anti-cycle reason:
 *   • untouched      — no first contact logged (freshLeads.FIRST_CONTACT_PENDING_WHERE)
 *   • assignedToday  — assigned/created today IST  (freshLeads.isAssignedToday)
 *   • website        — isWebsiteSource(lead.source) — computed here from lead.source,
 *     but may be passed in too; the flag wins when provided.
 */
export function leadSortTier(
  lead: {
    currentStatus?: string | null;
    followupDate?: Date | null;
    createdAt: Date;
    assignedAt?: Date | null;
    source?: string | null;
    leadOrigin?: string | null;
    importBatchId?: string | null;
  },
  today: { gte: Date; lt: Date },
  flags: {
    untouched?: boolean;
    assignedToday?: boolean;
    activePipeline?: boolean;
    website?: boolean;
  } = {},
): number {
  const fresh = isFreshStatus(lead.currentStatus);
  const createdToday = lead.createdAt >= today.gte && lead.createdAt < today.lt;
  const fu = lead.followupDate ?? null;
  // Back-compat: an omitted activePipeline flag means "assume active" so legacy
  // callers keep prior behaviour; tiers 0-3 are gated on it.
  const active = flags.activePipeline ?? true;
  const website = flags.website ?? isWebsiteSource(lead.source);

  // ── New Lalit priority (tiers 0-4). Only active-pipeline rows can occupy 0-3. ──
  if (active) {
    if (createdToday && fresh) return 0;                 // fresh lead created today
    if (createdToday && website) return 1;               // website lead created today
    if (createdToday) return 2;                          // any other manual create today
    if (flags.assignedToday) return 3;                   // assigned today
  }
  if (flags.untouched) return 4;                         // never contacted (any age, any origin)

  // ── Existing lower band (was tiers 2-6, now 5-9), preserved verbatim. ──
  if (fu != null && fu >= today.gte && fu < today.lt) return 5;  // follow-up due today
  if (fresh) return 6;                                          // fresh status (any age)
  if (fu != null && fu < today.gte) return 7;                    // overdue follow-up
  if (fu != null && fu >= today.lt) return 8;                    // future follow-up
  return 9;                                                      // everything else
}

// True when two status labels are EFFECTIVELY the same — identical after
// normalisation, canonical-equal, or a trivial spelling/tense variant
// ("Never Respond Phone Calls" vs "Never Responded Phone Calls"). Used to avoid
// rendering a near-duplicate "original sheet status" badge next to currentStatus.
export function statusesLookSame(a?: string | null, b?: string | null): boolean {
  const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (norm(canonicalStatus(a)) === norm(canonicalStatus(b))) return true;
  if (Math.abs(x.length - y.length) > 3) return false;
  // Levenshtein on the letters-only form — ≤3 edits ⇒ a trivial variant.
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[y.length] <= 3;
}

// ─── Agent-editable WORKING statuses ──────────────────────────────────────
// Agents may only set day-to-day working statuses. "Fresh Lead" is system-
// generated; outcome / classification statuses (War Fear, Funds Issue, Booked
// With Us, Sell Out, Already Bought, Number Changed, Pass Away, …) are applied
// only through the Reject flow / admin — they never appear in the agent
// dropdown so casual selection can't corrupt reporting.
export const DUBAI_AGENT_STATUSES: string[] = [
  "Not Contacted", "Follow Up", "Long Term Follow Up", "Mail Sent",
  "Wants Office Visit", "Zoom Meeting", "Meeting", "Visit Dubai", "Expo Only", "Not Interested",
];
export const INDIA_AGENT_STATUSES: string[] = [
  "Not Contacted", "Follow Up", "Details Shared", "Site Visit Schedule", "Meeting", "Postponed", "Not Interested",
];

export function agentStatusesForTeam(team: string | null | undefined): string[] {
  if (team === "India") return INDIA_AGENT_STATUSES;
  if (team === "Dubai") return DUBAI_AGENT_STATUSES;
  return [...new Set([...DUBAI_AGENT_STATUSES, ...INDIA_AGENT_STATUSES])];
}

/**
 * Status options for the lead-detail dropdown, by role.
 *  - AGENT:   working statuses only (no Fresh Lead, no outcomes, no Booked).
 *  - MANAGER: full team master minus Fresh Lead + Booked With Us.
 *  - ADMIN:   full team master (may correct Fresh Lead / set Booked With Us).
 * The lead's CURRENT status is always included so the select reflects reality
 * even when it's a status the role can't otherwise pick.
 */
export function selectableStatuses(
  team: string | null | undefined,
  role: string,
  currentStatus?: string | null,
): string[] {
  let list: string[];
  if (role === "AGENT") {
    list = [...agentStatusesForTeam(team)];
  } else if (role === "MANAGER") {
    list = statusesForTeam(team).filter(s => s !== "Fresh Lead" && !isBookedStatus(s));
  } else {
    list = [...statusesForTeam(team)];
  }
  if (currentStatus && !list.includes(currentStatus)) list = [currentStatus, ...list];
  return list;
}

/** Server-side guard: may this role manually set this status? */
export function canSetStatus(role: string, status: string, team: string | null | undefined): boolean {
  if (status === "Fresh Lead") return role === "ADMIN";  // system-generated; admin may correct
  if (isBookedStatus(status)) return role === "ADMIN";    // booking workflow / admin only
  if (role === "AGENT") return agentStatusesForTeam(team).includes(status);
  return true;  // manager / admin: any non-restricted team status
}

// ─── Status DISPLAY ordering (UI only — never changes stored data) ──────────
// Canonical priority (Lalit, 2026-06-21). "Today" is a FOLLOW-UP chip, not a
// status, so it is intentionally absent here. Applied to whatever team-subset a
// surface already shows (India vs Dubai stay disjoint — this only re-orders).
export const STATUS_DISPLAY_ORDER: string[] = [
  "Fresh Lead",
  "Wants Office Visit", "Want Office Visit", // canonical + legacy casing
  "Follow Up",
  "Visit Dubai",
  "Details Shared",
];
const STATUS_DISPLAY_RANK = new Map(STATUS_DISPLAY_ORDER.map((s, i) => [s.toLowerCase(), i]));

/** Sort comparator: priority-listed statuses first (in order), then the rest A→Z.
 *  Case-insensitive so "Wants Office Visit" casing variants rank alike. Display only. */
export function compareStatusDisplay(a: string, b: string): number {
  const ra = STATUS_DISPLAY_RANK.get((a ?? "").toLowerCase().trim()) ?? Number.MAX_SAFE_INTEGER;
  const rb = STATUS_DISPLAY_RANK.get((b ?? "").toLowerCase().trim()) ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : (a ?? "").localeCompare(b ?? "");
}

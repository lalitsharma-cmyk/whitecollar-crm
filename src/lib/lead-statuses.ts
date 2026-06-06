// Excel/MIS Status values used by White Collar Realty.
// These are the team's own status vocabulary — they come from the Excel MIS sheet
// and should be preserved exactly.
//
// STATUS IS THE ONLY WORKFLOW. There is no Stage system.
// No "won / lost / open" grouping — every status is equal.

export const EXCEL_STATUSES = [
  // Active pursuit
  "Not Contacted",
  "Fresh Lead",
  "Follow Up",
  "Long Term Follow Up",
  "Details Shared",
  "Mail Sent",
  // Meeting / Visit
  "Meeting",
  "Want Office Visit",
  "Zoom Meeting",
  "Site Visit Schedule",
  // Specialised
  "Commercial Investment",
  "Visit Dubai",
  "Expo Only",
  // Closed won
  "Booked with Us",
  // Sold / rented out
  "Sell Out",
  "Rent Out",
  "Leasing",
  // Location mismatch
  "Other Location",
  "Gurgaon",
  "Other Requirement",
  // Obstacle
  "Funds Issue",
  "War Fear",
  // Already bought / elsewhere
  "Already Bought",
  "Visited With Other Broker",
  // Lost / dead
  "Not Interested",
  "Broker",
  "Junk",
  "Low Budget",
  "Invalid Number",
  "Drop The Plan",
  "By Mistake Inquiry",
  "Just Searching",
  "Never Respond Phone Calls",
  "Not Able To Buy",
  "Pass Away",
  "Number Changed",
  "Repeated",
] as const;

export type ExcelStatus = (typeof EXCEL_STATUSES)[number];

// ─── Reminder suppression ─────────────────────────────────────────────────────
// Cron jobs (morning reminder, evening reminder, pre-meeting reminder, rescore)
// skip leads whose currentStatus is in this list.
// These are clearly dead leads where automation adds no value.
// Edit this list any time — no code changes required elsewhere.
export const SUPPRESSED_STATUSES: string[] = [
  "Junk",
  "Invalid Number",
  "Pass Away",
  "Number Changed",
  "By Mistake Inquiry",
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
// One specific color per status — no semantic grouping.
// Returns a Tailwind chip class applied on both the table chip and the popover.
const STATUS_COLORS: Record<string, string> = {
  // Active pursuit
  "Not Contacted":          "bg-slate-100 text-slate-600 border border-slate-200",
  "Fresh Lead":             "bg-blue-100 text-blue-700 border border-blue-200",
  "Follow Up":              "bg-orange-100 text-orange-700 border border-orange-200",
  "Long Term Follow Up":    "bg-purple-100 text-purple-700 border border-purple-200",
  "Details Shared":         "bg-sky-100 text-sky-700 border border-sky-200",
  "Mail Sent":              "bg-indigo-100 text-indigo-700 border border-indigo-200",
  // Meeting / Visit
  "Meeting":                "bg-teal-100 text-teal-700 border border-teal-200",
  "Want Office Visit":      "bg-teal-100 text-teal-700 border border-teal-200",
  "Zoom Meeting":           "bg-teal-100 text-teal-700 border border-teal-200",
  "Site Visit Schedule":    "bg-teal-100 text-teal-700 border border-teal-200",
  // Specialised
  "Commercial Investment":  "bg-violet-100 text-violet-700 border border-violet-200",
  "Visit Dubai":            "bg-teal-100 text-teal-700 border border-teal-200",
  "Expo Only":              "bg-cyan-100 text-cyan-700 border border-cyan-200",
  // Closed won
  "Booked with Us":         "bg-green-100 text-green-800 border border-green-200 font-semibold",
  // Sold / rented out
  "Sell Out":               "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Rent Out":               "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Leasing":                "bg-emerald-100 text-emerald-700 border border-emerald-200",
  // Location mismatch
  "Other Location":         "bg-gray-100 text-gray-600 border border-gray-200",
  "Gurgaon":                "bg-gray-100 text-gray-600 border border-gray-200",
  "Other Requirement":      "bg-gray-100 text-gray-600 border border-gray-200",
  // Obstacle
  "Funds Issue":            "bg-amber-100 text-amber-700 border border-amber-200",
  "War Fear":               "bg-amber-100 text-amber-800 border border-amber-200",
  // Already bought / elsewhere
  "Already Bought":         "bg-rose-100 text-rose-700 border border-rose-200",
  "Visited With Other Broker": "bg-rose-100 text-rose-700 border border-rose-200",
  // Lost / dead
  "Not Interested":         "bg-red-100 text-red-700 border border-red-200",
  "Broker":                 "bg-slate-100 text-slate-500 border border-slate-200",
  "Junk":                   "bg-slate-100 text-slate-400 border border-slate-200",
  "Low Budget":             "bg-red-100 text-red-600 border border-red-200",
  "Invalid Number":         "bg-slate-100 text-slate-400 border border-slate-200",
  "Drop The Plan":          "bg-slate-100 text-slate-500 border border-slate-200",
  "By Mistake Inquiry":     "bg-slate-100 text-slate-400 border border-slate-200",
  "Just Searching":         "bg-slate-100 text-slate-500 border border-slate-200",
  "Never Respond Phone Calls": "bg-slate-100 text-slate-500 border border-slate-200",
  "Not Able To Buy":        "bg-slate-100 text-slate-500 border border-slate-200",
  "Pass Away":              "bg-slate-100 text-slate-400 border border-slate-200",
  "Number Changed":         "bg-slate-100 text-slate-400 border border-slate-200",
  "Repeated":               "bg-slate-100 text-slate-500 border border-slate-200",
};

const FALLBACK_COLOR = "bg-slate-100 text-slate-600 border border-slate-200";

/**
 * Returns Tailwind chip classes for a given currentStatus value.
 * Each status has its own specific color — no semantic grouping.
 */
export function statusColor(s: string | null | undefined): string {
  if (!s) return FALLBACK_COLOR;
  return STATUS_COLORS[s] ?? FALLBACK_COLOR;
}

/**
 * @deprecated Use statusColor() instead.
 * Kept temporarily for files not yet migrated. Will be removed.
 */
export function excelStatusChip(s: string | null): string {
  return statusColor(s);
}

// ─── "Booked with Us" helper ─────────────────────────────────────────────────
// Single place to check if a lead has been booked. Used by investor detection,
// quality score, and weekly digest. No "won" concept — just this one status name.
export function isBookedStatus(currentStatus: string | null | undefined): boolean {
  return currentStatus === "Booked with Us";
}

// ─── Active-pursuit statuses (used by leadsForProject, quality score, etc.) ──
// Leads in these statuses are genuinely in play and worth pitching a property to.
// Excludes suppressed + dead statuses.
export const ACTIVE_PURSUIT_STATUSES: string[] = [
  "Not Contacted",
  "Fresh Lead",
  "Follow Up",
  "Long Term Follow Up",
  "Details Shared",
  "Mail Sent",
  "Meeting",
  "Want Office Visit",
  "Zoom Meeting",
  "Site Visit Schedule",
  "Commercial Investment",
  "Visit Dubai",
  "Expo Only",
  "Funds Issue",
  "War Fear",
];

// ─── Closing-stage statuses (for manager-review flagging) ────────────────────
// Leads in these statuses that go idle >24h get a manager flag.
export const CLOSING_STATUSES: string[] = [
  "Meeting",
  "Want Office Visit",
  "Zoom Meeting",
  "Site Visit Schedule",
  "Visit Dubai",
  "Expo Only",
  "Booked with Us",
];

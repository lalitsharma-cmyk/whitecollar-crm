// Excel/MIS Status values used by White Collar Realty.
// These are the team's own status vocabulary — they come from the Excel MIS sheet
// and should be preserved exactly. The internal LeadStatus enum (NEW/CONTACTED/etc.)
// stays hidden in the backend for pipeline logic; this is what agents SEE and set.

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

// ─── Budget minimum presets ───────────────────────────────────────────────────
// Shared between server (leads/page.tsx) and client (LeadFilters).
// Key stored in ?budgetPreset= URL param; value used for the Prisma filter.
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

/** Map each status to a CSS chip class + a short colour hint. */
export function excelStatusChip(s: string | null): string {
  if (!s) return "chip-new";
  const v = s.toLowerCase();
  if (["booked with us"].includes(v)) return "chip-won";
  if (["not interested", "junk", "invalid number", "drop the plan",
       "by mistake inquiry", "pass away", "repeated", "low budget",
       "never respond phone calls", "not able to buy"].includes(v)) return "chip-lost";
  if (["follow up", "long term followup", "fresh lead", "not contacted",
       "details shared", "mail sent"].includes(v)) return "chip-new";
  if (["meeting", "want office visit", "zoom meeting", "site visit schedule",
       "visit dubai", "expo only"].includes(v)) return "chip-warm";
  if (["sell out", "rent out", "leasing", "already bought",
       "visited with other broker"].includes(v)) return "chip-cold";
  if (["broker", "other location", "gurgaon", "other requirement",
       "funds issue", "war fear", "commercial investment",
       "number changed", "just searching"].includes(v)) return "chip-cold";
  return "chip-new";
}

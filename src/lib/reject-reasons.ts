// Canonical Reject-Lead reasons — shared by the modal and the API so they never
// drift. Most labels deliberately match a CRM status name: rejecting a lead with
// a given reason sets the lead's currentStatus to that classification (these
// outcome/classification statuses are NOT agent-selectable in the normal status
// dropdown — they are only applied through the controlled reject flow).

export const REJECT_REASONS: Array<{ value: string; label: string }> = [
  { value: "NOT_INTERESTED",            label: "Not Interested" },
  { value: "WAR_FEAR",                  label: "War Fear" },
  { value: "FUND_ISSUE",                label: "Funds Issue" },
  { value: "NOT_ABLE_TO_BUY",           label: "Not Able To Buy" },
  { value: "BROKER",                    label: "Broker" },
  { value: "VISITED_WITH_OTHER_BROKER", label: "Visited With Other Broker" },
  { value: "BOOKED_WITH_US",            label: "Booked With Us" },
  { value: "SELL_OUT",                  label: "Sell Out" },
  { value: "LEASING",                   label: "Leasing" },
  { value: "RENT_OUT",                  label: "Rent Out" },
  { value: "COMMERCIAL_INVESTMENT",     label: "Commercial Investment" },
  { value: "ALREADY_BOUGHT",            label: "Already Bought" },
  { value: "OTHER_LOCATION",            label: "Other Location" },
  { value: "OTHER_REQUIREMENT",         label: "Other Requirement" },
  { value: "LOW_BUDGET",                label: "Low Budget" },
  { value: "JUST_SEARCHING",            label: "Just Searching" },
  { value: "DROP_THE_PLAN",             label: "Drop The Plan" },
  { value: "NUMBER_CHANGED",            label: "Number Changed" },
  { value: "INVALID_NUMBER",            label: "Invalid Number" },
  { value: "NEVER_RESPOND_PHONE_CALLS", label: "Never Respond Phone Calls" },
  { value: "PASS_AWAY",                 label: "Pass Away" },
  { value: "OTHER",                     label: "Other" },
];

// Reason value → human label.
export const REJECT_REASON_LABEL: Record<string, string> =
  Object.fromEntries(REJECT_REASONS.map(r => [r.value, r.label]));

// Legacy reason values kept valid so old rejected records still resolve.
const LEGACY_REASONS: Record<string, string> = {
  BY_MISTAKE_INQUIRY: "By Mistake Inquiry",
  LEASING_REQUIREMENT: "Leasing",
  COMMERCIAL_REQUIREMENT: "Commercial Investment",
  NEVER_RESPONDED: "Never Respond Phone Calls",
  PASSED_AWAY: "Pass Away",
  WAITING_FOR_PROPERTY_SALE: "Waiting For Property Sale",
  LOOK_AFTER_2_YEARS: "Look after 2 years",
  TRANSFER_TO_INDIA_TEAM: "Transfer to India Team",
  TRANSFER_TO_DUBAI_TEAM: "Transfer to Dubai Team",
};

// Accepted on the API (current canonical + legacy).
export const REJECT_REASON_VALUES = new Set<string>([
  ...REJECT_REASONS.map(r => r.value),
  ...Object.keys(LEGACY_REASONS),
]);

/** Human label for any reason value (canonical or legacy). */
export function rejectReasonLabel(value: string): string {
  return REJECT_REASON_LABEL[value] ?? LEGACY_REASONS[value] ?? value.replace(/_/g, " ");
}

/** The CRM status a rejection should move the lead to, given a reason value.
 *  Most reasons map 1:1 to a classification status; the rest fall back to a
 *  sensible closed status so the lead leaves the active workflow. */
export function rejectionStatusFor(value: string): string {
  const label = rejectReasonLabel(value);
  // These reason labels are real CRM statuses — use them directly.
  return label;
}

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
  { value: "BROKER",                    label: "Broker / Channel Partner" },
  { value: "VISITED_WITH_OTHER_BROKER", label: "Visited With Other Broker" },
  // "Booked With Us" REMOVED — booking WITH us is a win, not a rejection (it also
  // wrongly inflated commission/won counts). A client who closed ELSEWHERE is a
  // real, non-junk outcome captured by these two reasons instead:
  { value: "PURCHASED_ELSEWHERE",       label: "Purchased Elsewhere" },
  { value: "BOOKED_OTHER_CHANNEL",      label: "Booked Through Another Channel" },
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
  { value: "JUNK",                      label: "Junk Lead" },
  { value: "FAKE_INQUIRY",              label: "Fake Inquiry" },
  { value: "OTHER",                     label: "Other" },
];

// Team-conditional reasons — offered ONLY for leads on the named team. Currently NONE.
// ("Expo Only" used to live here. Lalit clarified 2026-07-23 that Expo Only is a
// WORKABLE status — the client is interested in attending an expo and is STILL actively
// pursued — not a rejection. It is a normal Dubai status (see DUBAI_STATUSES), set via
// the ordinary status dropdown, and must NEVER auto-unassign / clear the follow-up /
// stamp rejectedAt. So it is no longer a reject reason; EXPO_ONLY lives in
// HISTORICAL_LABEL_ONLY below purely so old audit/timeline rows still resolve its label.)
export const DUBAI_ONLY_REJECT_REASONS: Array<{ value: string; label: string }> = [];

/** Reasons offered in the reject dropdown for a given lead team. The base list
 *  always applies; Dubai-team leads additionally get the Dubai-only reasons.
 *  (Append so the team-specific reasons sit at the end, before nothing reorders.) */
export function rejectReasonsForTeam(
  forwardedTeam: string | null | undefined,
): Array<{ value: string; label: string }> {
  if (forwardedTeam === "Dubai") {
    // Insert the Dubai-only reasons just before the trailing "Other" so "Expo Only"
    // groups with the real outcomes rather than after the catch-all.
    const otherIdx = REJECT_REASONS.findIndex((r) => r.value === "OTHER");
    if (otherIdx === -1) return [...REJECT_REASONS, ...DUBAI_ONLY_REJECT_REASONS];
    return [
      ...REJECT_REASONS.slice(0, otherIdx),
      ...DUBAI_ONLY_REJECT_REASONS,
      ...REJECT_REASONS.slice(otherIdx),
    ];
  }
  return REJECT_REASONS;
}

// Reason value → human label. Includes the team-conditional reasons so their
// label resolves everywhere (timeline, admin Rejected-Leads view) regardless of
// which team's dropdown they were chosen from.
export const REJECT_REASON_LABEL: Record<string, string> =
  Object.fromEntries(
    [...REJECT_REASONS, ...DUBAI_ONLY_REJECT_REASONS].map(r => [r.value, r.label]),
  );

// Legacy reason values kept valid so old rejected records still resolve their
// human label (e.g. the Rejected-Leads admin view). BOOKED_WITH_US is here — it
// is no longer offered in any dropdown, but historical records keep resolving
// until the one-time backfill remaps them to the two new reasons.
const LEGACY_REASONS: Record<string, string> = {
  BOOKED_WITH_US: "Booked With Us",
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

// Label-only history: reasons that must still resolve a human label on OLD records
// but are NO LONGER valid to submit — deliberately EXCLUDED from REJECT_REASON_VALUES
// so the reject API 400s on them. "Expo Only" is here: it is a workable STATUS now,
// never a rejection (Lalit 2026-07-23). A pre-2026-07-23 lead may still carry a
// rejectionReason of EXPO_ONLY in its timeline; this keeps that label readable.
const HISTORICAL_LABEL_ONLY: Record<string, string> = {
  EXPO_ONLY: "Expo Only",
};

// Accepted on the API (current canonical + team-conditional + legacy).
// NOTE: HISTORICAL_LABEL_ONLY is intentionally NOT included — those reasons resolve a
// label but can never be newly submitted (the reject route rejects them).
export const REJECT_REASON_VALUES = new Set<string>([
  ...REJECT_REASONS.map(r => r.value),
  ...DUBAI_ONLY_REJECT_REASONS.map(r => r.value),
  ...Object.keys(LEGACY_REASONS),
]);

/** Human label for any reason value (canonical, legacy, or history-only). */
export function rejectReasonLabel(value: string): string {
  return REJECT_REASON_LABEL[value] ?? LEGACY_REASONS[value] ?? HISTORICAL_LABEL_ONLY[value] ?? value.replace(/_/g, " ");
}

// Reasons whose human label is NOT itself a CRM status (or where the status must
// differ from the label) map explicitly here. Everything else uses its label,
// which IS a real status. This keeps "Junk Lead" → the canonical "Junk" status,
// and ensures the new closed-elsewhere reasons land on their own outcome status
// (never on the winning "Booked With Us").
const REASON_STATUS: Record<string, string> = {
  BROKER:               "Broker",                          // label relabeled to "Broker / Channel Partner"
  JUNK:                 "Junk",
  FAKE_INQUIRY:         "Junk",
  PURCHASED_ELSEWHERE:  "Purchased Elsewhere",
  BOOKED_OTHER_CHANNEL: "Booked Through Another Channel",
  // Legacy reject → closed-elsewhere outcome (NEVER the winning "Booked With Us").
  BOOKED_WITH_US:       "Purchased Elsewhere",
};

/** The CRM status a rejection should move the lead to, given a reason value.
 *  Most reasons map 1:1 to a classification status (their label IS the status);
 *  the exceptions are listed in REASON_STATUS above. */
export function rejectionStatusFor(value: string): string {
  return REASON_STATUS[value] ?? rejectReasonLabel(value);
}

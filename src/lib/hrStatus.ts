import type { HRCandidateStatus } from "@prisma/client";

export interface StatusDef {
  key: HRCandidateStatus;
  label: string;
  group: "active" | "closed";
  color: string;
}

// Candidate status set per the HR CRM final spec, in display order.
// Legacy enum values (HR_INTERVIEW_COMPLETED, FINAL_*, NOT_INTERESTED, NEVER_RESPONSE)
// are kept for old records but intentionally NOT offered in pickers — see LEGACY_STATUS_LABELS.
export const HR_STATUSES: StatusDef[] = [
  { key: "NEW", label: "New", group: "active", color: "bg-blue-100 text-blue-800" },
  { key: "NOT_CALLED", label: "Not Called By HR", group: "active", color: "bg-slate-100 text-slate-700" },
  { key: "INTERESTED", label: "Interested", group: "active", color: "bg-emerald-100 text-emerald-800" },
  { key: "PIPELINE", label: "Pipeline", group: "active", color: "bg-emerald-100 text-emerald-800" },
  { key: "VIRTUAL_INTERVIEW_SCHEDULED", label: "Virtual Interview Scheduled", group: "active", color: "bg-indigo-100 text-indigo-800" },
  { key: "F2F_INTERVIEW_SCHEDULED", label: "F2F Interview Scheduled", group: "active", color: "bg-purple-100 text-purple-800" },
  { key: "INTERVIEW_HELD", label: "Interview Held", group: "active", color: "bg-cyan-100 text-cyan-800" },
  { key: "NO_SHOW", label: "No Show", group: "active", color: "bg-rose-100 text-rose-700" },
  { key: "SHORTLISTED", label: "Shortlisted", group: "active", color: "bg-teal-100 text-teal-800" },
  { key: "HOLD", label: "On Hold", group: "active", color: "bg-orange-100 text-orange-800" },
  { key: "OFFER_RELEASED", label: "Offer Released", group: "active", color: "bg-amber-100 text-amber-800" },
  { key: "EXPECTED_JOINING", label: "Expected Joining", group: "active", color: "bg-lime-100 text-lime-800" },
  { key: "FRESHER", label: "Fresher", group: "active", color: "bg-sky-100 text-sky-800" },
  { key: "JOINED", label: "Joined", group: "closed", color: "bg-green-100 text-green-800" },
  { key: "NOT_RESPONDING", label: "Not Responding", group: "closed", color: "bg-gray-100 text-gray-600" },
  { key: "SWITCH_OFF", label: "Switch Off", group: "closed", color: "bg-gray-100 text-gray-600" },
  { key: "INVALID_NUMBER", label: "Invalid Number", group: "closed", color: "bg-gray-100 text-gray-600" },
  { key: "WRONG_NUMBER", label: "Wrong Number", group: "closed", color: "bg-red-100 text-red-700" },
  { key: "HIGH_SALARY", label: "High Salary", group: "closed", color: "bg-pink-100 text-pink-700" },
  { key: "NOT_SUITABLE", label: "Not Suitable", group: "closed", color: "bg-red-100 text-red-700" },
  { key: "OFFER_DECLINED", label: "Offer Declined", group: "closed", color: "bg-orange-200 text-orange-800" },
  { key: "REJECTED", label: "Rejected", group: "closed", color: "bg-red-200 text-red-800" },
  { key: "OTHER_PROFILE", label: "Other Profile", group: "closed", color: "bg-pink-100 text-pink-700" },
  { key: "CLOSED", label: "Closed", group: "closed", color: "bg-slate-200 text-slate-600" },
];

// Legacy values kept only for displaying old records (not selectable).
export const LEGACY_STATUS_LABELS: Record<string, string> = {
  HR_INTERVIEW_COMPLETED: "HR Interview Completed",
  FINAL_INTERVIEW_SCHEDULED: "Final Interview Scheduled",
  FINAL_INTERVIEW_COMPLETED: "Final Interview Completed",
  NOT_INTERESTED: "Not Interested",
  NEVER_RESPONSE: "Never Response",
};

export const ACTIVE_STATUS_DEFS = HR_STATUSES.filter(s => s.group === "active");
export const CLOSED_STATUS_DEFS = HR_STATUSES.filter(s => s.group === "closed");

// Statuses with no open work expected (terminal / closed, incl. Joined + legacy closed).
// Used for "active candidate needs a follow-up" checks and default list hiding.
export const CLOSED_STATUS_KEYS: HRCandidateStatus[] = [
  ...CLOSED_STATUS_DEFS.map(s => s.key),
  "NOT_INTERESTED", "NEVER_RESPONSE",
] as HRCandidateStatus[];

export function statusLabel(s: string): string {
  return HR_STATUSES.find(x => x.key === s)?.label
    ?? LEGACY_STATUS_LABELS[s]
    ?? s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export function statusColor(s: string): string {
  return HR_STATUSES.find(x => x.key === s)?.color ?? "bg-gray-100 text-gray-600";
}

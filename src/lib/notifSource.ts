// Notification SOURCE TRACKING (Lalit, 2026-07-03).
//
// Every notification MUST be traceable to a real CRM record — the system may never
// invent a reminder or a callback. notify() requires a `source`, so a notification
// with no backing record cannot be created (compiler-enforced at all 50 call sites).
//
//   • source.type  — one of NOTIF_SOURCE_TYPES (the category shown as a chip).
//   • source.id    — the EXACT backing record id (Activity / Lead / CallLog / Device …)
//                    so the UI's "Open Source" button jumps to what generated it.
//   • source.createdById — the user (or null for a system/cron job) behind the event.
//
// PURE module (no prisma/server-only import) so client components can render the
// labels + the notifications API can store the values.

export const NOTIF_SOURCE_TYPES = [
  "FOLLOWUP",      // Lead.followupDate — a scheduled follow-up
  "REMINDER",      // a user-created reminder
  "MEETING",       // Activity OFFICE/VIRTUAL/EXPO meeting
  "SITE_VISIT",    // Activity SITE_VISIT / HOME_VISIT
  "CALL_OUTCOME",  // a logged call outcome (incl. a requested callback)
  "AI",            // an AI suggestion / re-score saved into the CRM
  "MANUAL_NOTE",   // a manual note / remark
  "CALENDAR",      // a calendar event
  "LEAD_INTAKE",   // a new lead arriving (website / API / import)
  "ASSIGNMENT",    // a lead / buyer (re)assignment
  "ESCALATION",    // a manager escalation / reply / resolve
  "DEVICE",        // device / login / location security
  "DATA_QUALITY",  // a data-quality / reconciliation alert
  "AGENT_STATUS",  // an agent field-status event
  "VOICE",         // a voice message / broadcast
  "EOI",           // an expression-of-interest approval
  "SYSTEM",        // an operational alert with no single record (rare; must still be true)
] as const;

export type NotifSourceType = (typeof NOTIF_SOURCE_TYPES)[number];

export const NOTIF_SOURCE_LABEL: Record<NotifSourceType, string> = {
  FOLLOWUP: "Follow-up",
  REMINDER: "Reminder",
  MEETING: "Meeting",
  SITE_VISIT: "Site Visit",
  CALL_OUTCOME: "Call Outcome",
  AI: "AI Suggestion",
  MANUAL_NOTE: "Manual Note",
  CALENDAR: "Calendar",
  LEAD_INTAKE: "Lead Intake",
  ASSIGNMENT: "Assignment",
  ESCALATION: "Escalation",
  DEVICE: "Device",
  DATA_QUALITY: "Data Quality",
  AGENT_STATUS: "Agent Status",
  VOICE: "Voice",
  EOI: "EOI Approval",
  SYSTEM: "System",
};

/** The source of truth behind ONE notification. `type` is mandatory (a notification
 *  with no source must not exist); `id` points at the exact backing record. */
export interface NotifSource {
  type: NotifSourceType;
  id?: string | null;
  createdById?: string | null;
}

export function isNotifSourceType(v: unknown): v is NotifSourceType {
  return typeof v === "string" && (NOTIF_SOURCE_TYPES as readonly string[]).includes(v);
}

export function notifSourceLabel(t: string | null | undefined): string {
  return t && isNotifSourceType(t) ? NOTIF_SOURCE_LABEL[t] : "System";
}

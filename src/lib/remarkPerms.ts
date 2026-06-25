// Shared, PURE permission check for editing an existing remark / note. Both the
// edit APIs (backend) and the edit affordances (frontend) call this, so the rule
// cannot be bypassed by un-hiding a button.
//
// Rule (Lalit, 2026-06-21):
//   • ADMIN / MANAGER  → edit ANY remark/note, ANY date. (Super-admins — Lalit,
//     Samir — are always role ADMIN, so they're covered here.)
//   • AGENT            → edit ONLY their OWN item, and ONLY on the same IST
//     calendar day it was created. From the next IST day on, edit is disabled.
//   • An item with no author or no createdAt (e.g. imported raw-history text that
//     has no per-line signal) → admins/managers only; agents never.
//
// Display-and-backend only — it never changes or deletes the underlying remark.

export type EditableActor = { id: string; role: string };

/** IST (UTC+5:30, no DST) calendar-date key — "YYYY-MM-DD". */
export function istDayKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function canEditRemark(
  me: EditableActor,
  item: { createdById?: string | null; createdAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (me.role === "ADMIN" || me.role === "MANAGER") return true;
  if (!item.createdById || !item.createdAt) return false; // no own/same-day signal
  const d = item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt);
  if (isNaN(d.getTime())) return false;
  return item.createdById === me.id && istDayKey(d) === istDayKey(now);
}

// ─── Smart-Timeline ACTIVITY edit gate ────────────────────────────────────────
// Per-entry Edit on a CRM Activity row in the Smart Timeline. Same OWN + same-IST-
// day rule as a free-text note (canEditRemark), but additionally restricted — for
// AGENTS — to the activity KINDS that carry the agent's OWN free-text remark
// (a meeting/visit/discussion/email they logged). System-generated rows
// (STATUS_CHANGE, LEAD_CREATED, COLD_TO_LEAD, REMINDER_FIRED, ASSIGNMENT, …) and
// the call/WhatsApp rows (which edit via their own note path) are NEVER agent-
// editable, even on the same day. ADMIN / MANAGER keep their existing rights
// (edit ANY activity, ANY date) — this never narrows or widens them.
//
// Used by BOTH the Edit-button visibility (ConversationStreamCard) and the server
// PATCH authorization (api/leads/[id]/activities/[activityId]) so the rule is a
// single source of truth and cannot be bypassed by un-hiding the button.

/** Activity `type` values an AGENT may edit (their own free-text conversational content). */
export const AGENT_EDITABLE_ACTIVITY_TYPES: ReadonlySet<string> = new Set<string>([
  "SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING",
  "MEETING", "PROJECT_DISCUSSED", "BROCHURE_SENT", "EMAIL", "NOTE",
]);

export function canEditActivity(
  me: EditableActor,
  activity: { type?: string | null; createdById?: string | null; createdAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  // Admin / Manager (super-admins are role ADMIN) — unchanged: any activity, any date.
  if (me.role === "ADMIN" || me.role === "MANAGER") return true;
  // Agent — kind must be an own-authored free-text type, AND own + same IST day.
  if (!activity.type || !AGENT_EDITABLE_ACTIVITY_TYPES.has(activity.type)) return false;
  return canEditRemark(me, { createdById: activity.createdById, createdAt: activity.createdAt }, now);
}

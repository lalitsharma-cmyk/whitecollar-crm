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

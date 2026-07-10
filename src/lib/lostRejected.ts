import { LOST_STATUSES, CLOSED_OUTCOME_STATUSES } from "@/lib/lead-statuses";

// ─────────────────────────────────────────────────────────────────────────────
// LOST / REJECTED ownership rule (Lalit 2026-07-10).
//
// The moment a lead becomes LOST or REJECTED it stops being anyone's active work:
//   • the assignment is removed        (ownerId → null, assignedAt → null)
//   • the last working agent is kept   (previousOwnerId — never overwritten once set)
//   • the follow-up is cleared         (followupDate + reminder → null)
// so it can never sit in a follow-up queue, an active workload, or an agent's book.
//
// WON / CLOSED is deliberately DIFFERENT: a booked/sold/leased lead KEEPS its owner
// (that ownership IS the booking attribution) — it only loses its follow-up date.
//
// The Reject route already applied this (previousOwnerId + unassign + clear follow-up);
// this helper makes the SAME rule fire on every other status-write path, so a lead that
// goes Lost via a plain status change behaves identically. Conversation history, remarks,
// calls, notes and activities are NEVER touched — only these ownership/follow-up fields.
// ─────────────────────────────────────────────────────────────────────────────

export function isLostStatus(status: string | null | undefined): boolean {
  return !!status && LOST_STATUSES.includes(status);
}
export function isClosedStatus(status: string | null | undefined): boolean {
  return !!status && CLOSED_OUTCOME_STATUSES.includes(status);
}

/** The fields a status write must ALSO set when the new status is terminal.
 *  Returns `{}` for a non-terminal status (caller merges it into its update data).
 *  `cur` is the lead's CURRENT ownership state (read before the update). */
export function terminalStatusSideEffects(
  newStatus: string | null | undefined,
  cur: { ownerId: string | null; previousOwnerId: string | null },
): {
  followupDate?: null;
  followupReminderSentAt?: null;
  previousOwnerId?: string | null;
  ownerId?: null;
  assignedAt?: null;
} {
  const lost = isLostStatus(newStatus);
  const closed = isClosedStatus(newStatus);
  if (!lost && !closed) return {};
  // Every terminal lead loses its follow-up (it is done — no future queue entry).
  const base = { followupDate: null, followupReminderSentAt: null } as const;
  // Won/Closed KEEPS its owner — that assignment is the booking attribution.
  if (!lost) return { ...base };
  return {
    ...base,
    // Previous Owner = the LAST ACTIVE owner, exactly as the reject routes write it
    // (`previousOwnerId: lead.ownerId`). So the CURRENT owner wins: a lead rejected
    // under Tanuj, later reactivated and reassigned to Yasir, then lost again must
    // read "Previous Owner: Yasir" — not Tanuj.
    // Falling back to the stored value keeps this IDEMPOTENT: re-saving a status on a
    // lead that is ALREADY lost/unassigned (ownerId null) must not wipe the name to
    // null. That's the same hazard the bulk-reject SQL guards with `ownerId IS NOT NULL`.
    previousOwnerId: cur.ownerId ?? cur.previousOwnerId,
    ownerId: null,
    assignedAt: null,
  };
}

/** Collapse a bulk status change into the FEWEST possible `updateMany` groups.
 *  A non-terminal or Won/Closed status is uniform across every lead → ONE group.
 *  A LOST status stashes a per-lead `previousOwnerId`, so it groups by that value —
 *  bounded by the agent count (~10), never by the number of leads. This keeps a
 *  500-lead bulk update to a handful of round-trips instead of 500 sequential ones. */
export function groupTerminalUpdates<T extends { id: string; ownerId: string | null; previousOwnerId: string | null }>(
  newStatus: string | null | undefined,
  leads: T[],
): { ids: string[]; data: ReturnType<typeof terminalStatusSideEffects> }[] {
  if (leads.length === 0) return [];
  if (!isLostStatus(newStatus)) {
    // Uniform: {} for a workable status, or the follow-up clear for Won/Closed.
    const data = terminalStatusSideEffects(newStatus, { ownerId: null, previousOwnerId: null });
    return [{ ids: leads.map((l) => l.id), data }];
  }
  const byPrev = new Map<string, T[]>();
  for (const l of leads) {
    // Same precedence as terminalStatusSideEffects — the group KEY *is* the value it writes.
    const key = l.ownerId ?? l.previousOwnerId ?? "";
    const bucket = byPrev.get(key);
    if (bucket) bucket.push(l);
    else byPrev.set(key, [l]);
  }
  return Array.from(byPrev.values()).map((group) => ({
    ids: group.map((l) => l.id),
    data: terminalStatusSideEffects(newStatus, { ownerId: group[0].ownerId, previousOwnerId: group[0].previousOwnerId }),
  }));
}

/** True when this lead is Lost-or-Rejected (the set the rule governs). */
export function isLostOrRejected(l: { currentStatus: string | null; rejectedAt: Date | null }): boolean {
  return l.rejectedAt != null || isLostStatus(l.currentStatus);
}

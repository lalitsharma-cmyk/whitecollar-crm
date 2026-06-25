// followup — the SINGLE source of truth for "what is the next follow-up date
// after an agent COMPLETES the current one?".
//
// WHY: completing a follow-up must ROLL the next touchpoint forward, never blank
// it. A lead whose follow-up is cleared silently drops off the Action-List /
// Overdue board and is forgotten — exactly the failure this helper prevents.
// Every surface that completes a follow-up (the action-complete route today, the
// existing-data repair script tomorrow) MUST funnel through this one function so
// the rule can never drift between them.
//
// RULE (Lalit-confirmed): nextFollowup = completion-moment + 1 day. The
// completion moment is "now" when the agent clicks Complete, so the result is
// ALWAYS in the future — even for a badly-overdue lead (we deliberately key off
// the completion time, NOT the old followupDate, so a follow-up that was due 5
// days ago still rolls to tomorrow rather than to a past date).
//
// TIME-OF-DAY: we add exactly 24h (literal +1 calendar day at the SAME
// wall-clock time the agent completed at). Keeping the completion time-of-day is
// intentional — a lead completed at 3pm rolls to 3pm tomorrow, so the existing
// pre-follow-up reminder cron fires at a sensible hour rather than at midnight.

/** One day in milliseconds. */
export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next follow-up date after a follow-up is completed at `completedAt`.
 * = completedAt + 1 day (same time-of-day). Pure function — no Date.now() inside,
 * so it is deterministic and unit-testable: pass the completion instant in.
 *
 * Callers pass the moment Complete was clicked (`new Date()` in the route). The
 * result is guaranteed strictly after `completedAt`, hence always in the future.
 */
export function nextFollowupAfterCompletion(completedAt: Date): Date {
  return new Date(completedAt.getTime() + ONE_DAY_MS);
}

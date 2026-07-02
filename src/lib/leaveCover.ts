// ────────────────────────────────────────────────────────────────────────────
// Pure, IO-free core of the agent leave-cover mechanism (#16 — Lalit 2026-07-02).
// Split out from leave.ts so the decision logic is unit-testable WITHOUT pulling
// in prisma / server-only modules. leave.ts wraps these with the DB/setting IO.
// ────────────────────────────────────────────────────────────────────────────

export interface LeaveEntry {
  userId: string;
  until: string; // inclusive IST calendar day, "YYYY-MM-DD"
}

/** Parse the raw `agentsOnLeave` setting value → well-formed entries (bad rows dropped). */
export function parseLeaveEntries(raw: string | null | undefined): LeaveEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is LeaveEntry =>
      !!e && typeof e === "object" &&
      typeof (e as { userId?: unknown }).userId === "string" &&
      typeof (e as { until?: unknown }).until === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test((e as { until: string }).until),
  );
}

/** Entries still in effect on `todayKey` (IST "YYYY-MM-DD"): until >= today (inclusive).
 *  ISO date strings compare lexicographically, so a plain >= is correct. */
export function entriesInEffect(entries: LeaveEntry[], todayKey: string): LeaveEntry[] {
  return entries.filter((e) => e.until >= todayKey);
}

/**
 * Choose the assignee honoring leave-cover — the pure decision:
 *   • target not on leave        → target (strict passthrough, no behavior change)
 *   • target on leave            → first not-on-leave teammate (≠ target), in the
 *                                  given order (deterministic), else
 *   • no free teammate           → the manager, if not on leave, else
 *   • nobody available           → null (park awaiting-team for a human)
 * `teammates` is the ordered list of candidate same-team agent ids (may include target).
 */
export function pickCoverAssignee(
  target: string | null,
  onLeave: ReadonlySet<string>,
  teammates: readonly string[],
  managerId: string | null,
): string | null {
  if (!target) return null;
  if (!onLeave.has(target)) return target;
  const mate = teammates.find((id) => id !== target && !onLeave.has(id));
  if (mate) return mate;
  if (managerId && !onLeave.has(managerId)) return managerId;
  return null;
}

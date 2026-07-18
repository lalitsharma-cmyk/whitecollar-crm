// ═════════════════════════════════════════════════════════════════════════════
// OWNER-SPECIFIC CALL-ATTEMPT CYCLE (Lalit spec, 2026-07-17)
//
// ONE engine for two business rules, both keyed on calls made by the CURRENT
// owner since they took ownership (assignLeadTo resets the cycle):
//
//   👻 GHOSTING — Normal Leads only (NOT Revival/cold; buyers have their own
//      engine in buyerLifecycle.ts). attemptCount ≥ ghostingThreshold (Setting,
//      default 10) with ZERO meaningful connects and a workable, non-engaged
//      status → ghostingAt stamped. A SECONDARY tag: never replaces the status.
//      Cleared by a meaningful connect or an ownership change. Read surfaces
//      re-check eligibility via isGhostingDisplay (a status may move to terminal
//      /engaged after the stamp — the tag must vanish without a write).
//
//   ↩︎ REVIVAL AUTO-RETURN — Revival (cold) leads only. attemptCount ≥
//      revivalMaxAttempts (Setting, default 5) with zero connects → the record
//      leaves the agent's queue back to the Admin Revival pool: ownerId → null,
//      previousOwnerId stamped, returnedToPoolAt stamped, revivalCycle++.
//      History/remarks/call logs/WhatsApp are untouched. Reassignment gives the
//      next agent a fresh cycle (assignLeadTo reset). Event-driven — NO cron.
//
// What counts (CallOutcome): meaningful = CONNECTED / CALLBACK / INTERESTED /
// NOT_INTERESTED (a human answered — even "not interested" is a conversation,
// the lead may go Lost separately but it is NOT ghosting). Unsuccessful try =
// NOT_PICKED / BUSY / SWITCHED_OFF / WRONG_NUMBER. Only OUTBOUND calls count as
// attempts; an INBOUND answered call counts as a connect (the client responded),
// an INBOUND missed call counts as nothing.
//
// NOT counted at all (2026-07-18): PENDING = INITIATED / RINGING — a dial that
// has not resolved. See the guard at the top of recordLeadCallAttempt. The row is
// re-submitted here when it transitions to its terminal outcome, and THAT is what
// moves the cycle. One dial = one CallLog row = at most one attempt.
//
// FALL-THROUGH (unchanged, flagged for review): the "unsuccessful try" branch is
// a fall-through, not an allow-list, so the new terminal states FAILED / CANCELLED
// / MISSED each count as one attempt on an OUTBOUND row (an INBOUND MISSED already
// counts as nothing via the INBOUND guard below). FAILED/MISSED match the existing
// SWITCHED_OFF/NOT_PICKED semantics. CANCELLED — the agent aborted the dial before
// it resolved — is the debatable one: it is a real inflation vector for mis-taps,
// but excluding it is a business-rule change for Lalit to make, not a silent one.
// If it should stop counting, add it to the guard above; do NOT widen the PENDING
// set to include it (pending vs cancelled differ everywhere else: a CANCELLED row
// IS resolved and must still appear in call totals).
//
// Only calls by the CURRENT OWNER move the cycle — an admin dialing someone
// else's lead never pushes it toward ghosting/return (Lalit: "attempts are
// owner-specific").
// ═════════════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { isRevivalOrigin } from "@/lib/moduleSource";
import {
  isMeaningfulOutcome,
  isGhostingEligible,
  isPendingCall,
  GHOSTING_DEFAULT_THRESHOLD,
  REVIVAL_DEFAULT_MAX_ATTEMPTS,
} from "@/lib/ghosting";

// The pure classification half (outcome sets, eligibility predicates, the
// GHOSTING_DISPLAY_WHERE filter twin, resetAttemptCycleData) lives in
// lib/ghosting.ts so prisma-free modules (leadFilterWhere, client components,
// regression probes) can import it. Re-exported here for one-stop importing.
export * from "@/lib/ghosting";

// ─── Settings (string store; clamped so a typo can't brick the rules) ────────

export async function getGhostingThreshold(): Promise<number> {
  const raw = parseInt(await getSetting("ghostingThreshold"), 10);
  return Number.isFinite(raw) && raw >= 3 && raw <= 30 ? raw : GHOSTING_DEFAULT_THRESHOLD;
}

export async function getRevivalMaxAttempts(): Promise<number> {
  const raw = parseInt(await getSetting("revivalMaxAttempts"), 10);
  return Number.isFinite(raw) && raw >= 2 && raw <= 15 ? raw : REVIVAL_DEFAULT_MAX_ATTEMPTS;
}

// ─── The write path — called from every CallLog write site ───────────────────

export type RecordAttemptResult = {
  counted: boolean;
  connected?: boolean;
  ghosted?: boolean;
  autoReturned?: boolean;
  /** Ignored because the call has not resolved yet (INITIATED / RINGING).
   *  Distinct from `counted:false` for a non-owner: this one WILL count later,
   *  when the same row transitions to a terminal outcome. */
  pending?: boolean;
};

/**
 * Advance the current owner's attempt cycle for one logged call. Fire-and-forget
 * safe: any throw is caught by callers — a broken counter must never block a call
 * from being logged. Small read→update race (two simultaneous logs) is tolerated:
 * worst case the threshold fires one call late.
 */
export async function recordLeadCallAttempt(input: {
  leadId: string;
  actorId: string | null | undefined;
  outcome: string;
  direction?: "OUTBOUND" | "INBOUND" | string;
  at?: Date;
}): Promise<RecordAttemptResult> {
  const { leadId, actorId, outcome } = input;
  const at = input.at ?? new Date();
  const direction = input.direction ?? "OUTBOUND";
  if (!actorId) return { counted: false };

  // ⛔ UNRESOLVED DIAL — hard stop BEFORE any read or write (Lalit P0, 2026-07-18).
  // Every "Call" button now writes a CallLog the instant it is tapped, at
  // INITIATED, and the SAME row is transitioned to a terminal outcome later. The
  // tap itself carries NO information about whether the client was reached, so it
  // must move NOTHING: no attemptCount, no connectedCount, no lastAttemptAt/By
  // stamp, no 👻 ghosting stamp, no ↩︎ revival auto-return. Without this guard an
  // agent tapping Call 10 times on a number that never rings would false-tag the
  // lead 👻 Ghosting, and 5 taps would rip a Revival record out of their queue and
  // back to the Admin pool — from taps alone, with no call ever having happened.
  //
  // The cycle advances when the row RESOLVES: the transition to the terminal
  // outcome must call this function again with that outcome (see the note in
  // lib/ghosting.ts). Returning early here — rather than counting the dial and
  // trying to un-count it later — keeps the counters monotonic and means a dial
  // that never resolves (app killed, browser closed) simply never counts.
  if (isPendingCall(outcome)) return { counted: false, pending: true };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true, name: true, ownerId: true, leadOrigin: true, currentStatus: true,
      attemptCount: true, connectedCount: true, ghostingAt: true, revivalCycle: true,
      deletedAt: true,
    },
  });
  // Only the CURRENT owner's calls move the cycle (owner-specific attempts).
  if (!lead || lead.deletedAt || !lead.ownerId || lead.ownerId !== actorId) {
    return { counted: false };
  }

  if (isMeaningfulOutcome(outcome)) {
    // A conversation happened (either direction) → count the connect, clear 👻.
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        connectedCount: { increment: 1 },
        lastAttemptAt: at,
        lastAttemptById: actorId,
        ghostingAt: null,
      },
    });
    return { counted: true, connected: true };
  }

  // Unsuccessful try. A missed INBOUND call is not an attempt BY the owner.
  if (direction === "INBOUND") return { counted: false };

  const newAttempts = lead.attemptCount + 1;
  const base = {
    attemptCount: { increment: 1 },
    lastAttemptAt: at,
    lastAttemptById: actorId,
  } as const;

  // ↩︎ Revival auto-return (cold leads only).
  if (isRevivalOrigin(lead.leadOrigin)) {
    const maxAttempts = await getRevivalMaxAttempts();
    const status = lead.currentStatus ?? "";
    if (newAttempts >= maxAttempts && lead.connectedCount === 0 && !TERMINAL_STATUSES.includes(status)) {
      const previousOwnerId = lead.ownerId;
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          ...base,
          ownerId: null,               // back to the Admin Revival queue
          previousOwnerId,             // "Previous Owner = Agent A"
          returnedToPoolAt: at,
          revivalCycle: { increment: 1 },
          followupDate: null,          // nothing left scheduled for the old owner
        },
      });
      // Audit + notifications are best-effort — the return itself already happened.
      try {
        const { audit } = await import("@/lib/audit");
        await audit({
          userId: actorId,
          action: "lead.revival.auto-return",
          entity: "Lead",
          entityId: leadId,
          meta: {
            previousOwnerId,
            attempts: newAttempts,
            maxAttempts,
            cycleNow: lead.revivalCycle + 1,
            trigger: "attempt-threshold",
          },
        });
        const [{ notify, notifyRoles }, agent] = await Promise.all([
          import("@/lib/notify"),
          prisma.user.findUnique({ where: { id: previousOwnerId }, select: { name: true } }),
        ]);
        await notifyRoles(["ADMIN"], {
          kind: "LEAD_ASSIGNED",
          severity: "WARNING",
          title: `↩︎ Revival returned: ${lead.name}`,
          body: `${newAttempts} call attempts by ${agent?.name ?? "the agent"} with no response — back in the Admin Revival queue (cycle ${lead.revivalCycle + 1}).`,
          linkUrl: `/revival-engine/cold-data/${leadId}`,
          source: { type: "ASSIGNMENT", id: leadId, createdById: actorId },
        });
        await notify({
          userId: previousOwnerId,
          kind: "LEAD_ASSIGNED",
          severity: "INFO",
          title: `↩︎ ${lead.name} returned to Admin`,
          body: `${newAttempts} attempts with no response — the record left your Revival queue automatically.`,
          linkUrl: `/revival-engine/cold-data/${leadId}`,
          source: { type: "ASSIGNMENT", id: leadId, createdById: actorId },
        });
      } catch (e) {
        console.error("[callAttempts] auto-return notify/audit failed", leadId, e);
      }
      return { counted: true, autoReturned: true };
    }
    await prisma.lead.update({ where: { id: leadId }, data: base });
    return { counted: true };
  }

  // 👻 Ghosting stamp (normal leads only; stamp once — display guard handles the rest).
  const threshold = await getGhostingThreshold();
  const eligible =
    !lead.ghostingAt &&
    isGhostingEligible(
      { ...lead, attemptCount: newAttempts },
      threshold,
    );
  await prisma.lead.update({
    where: { id: leadId },
    data: eligible ? { ...base, ghostingAt: at } : base,
  });
  return { counted: true, ghosted: eligible };
}

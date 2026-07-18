// ────────────────────────────────────────────────────────────────────────────
// callLogService.ts — THE one service every module uses to write a CallLog.
//
// WHY THIS EXISTS (Lalit P0, 2026-07-18)
// Before this file, 17 "Call" affordances across the CRM were presentational
// `tel:` links that recorded NOTHING — a call only appeared in the CRM if the
// agent later remembered to fill the Log-Call form. One route (leads/[id]/
// call-initiated) did record a dial, but wrote an Activity, not a CallLog, so
// 1,408 dials in 30 days were invisible to Call Logs / reports / the engine.
//
// ── THE CONTRACT ────────────────────────────────────────────────────────────
//
//   ONE DIAL = ONE CallLog ROW. Never two. Ever.
//
// A call is a STATE MACHINE on a single row, not a stream of rows:
//
//     startCall()          resolveOrCreateCall() / transitionCall()
//   ─────────────────►  ┌──────────┐  ─────────────────────────►  ┌──────────┐
//   (agent taps Call)   │ INITIATED│    (agent logs the call,     │ CONNECTED│
//                       │ RINGING  │     or telephony reports     │ NOT_PICKED│
//                       │ =PENDING │     the final status)        │ …=TERMINAL│
//                       └──────────┘                              └──────────┘
//
//   PENDING  = INITIATED · RINGING            → a dial with no result YET.
//   TERMINAL = everything else                → the attempt resolved.
//              (CONNECTED also means "Completed"; NOT_PICKED also "No Answer".)
//
// ── THE THREE ENTRY POINTS ──────────────────────────────────────────────────
//
//   startCall({leadId|buyerId, userId, phoneNumber?})
//     Called the instant an agent taps a dial affordance (via the
//     /api/calls/dial beacon). Writes outcome=INITIATED. Resolves the phone
//     from the record when not supplied. NEVER throws into the caller — a
//     logging failure must never block the agent's phone from dialling.
//
//   transitionCall(callLogId, nextOutcome, patch?)
//     Moves the SAME row forward. Never creates a second row. Illegal moves
//     are refused (see LEGAL TRANSITIONS below), no-ops are ignored.
//
//   resolveOrCreateCall({leadId|buyerId, userId, outcome, …})
//     ★ THE ANTI-DUPLICATE GUARANTEE ★ — used by the Log-Call form and the
//     telephony sink. If a recent PENDING row already exists for this
//     (record, user) it is TRANSITIONED; only if none exists is a terminal row
//     created. That is what stops "tap Call, then log the call" from producing
//     two rows for one conversation.
//
// ── LEGAL TRANSITIONS ───────────────────────────────────────────────────────
//   PENDING  → PENDING    ✔ progress            (INITIATED → RINGING)
//   PENDING  → TERMINAL   ✔ resolution          (the normal path)
//   TERMINAL → TERMINAL   ✔ ONLY with { correction: true } — a genuine
//                           correction of a mis-logged outcome, never a
//                           routine re-write.
//   TERMINAL → PENDING    ✘ NEVER — a finished call cannot be un-resolved.
//   X        → X          ∅ no-op, silently ignored (idempotent retries).
//
// ── INVARIANTS THE REST OF THE CRM DEPENDS ON ───────────────────────────────
//   1. A PENDING row is NOT an attempt. The 👻 ghosting engine, the Revival
//      auto-return-at-5 and every "calls made" count MUST exclude PENDING
//      (use isPendingCall / PENDING_CALL_OUTCOMES) — otherwise a dial that
//      never connects would fire a false 👻 tag, a false return to the Admin
//      queue, and inflate every call count.
//   2. This service NEVER writes an Activity / BuyerActivity timeline row and
//      NEVER touches the attempt counters. Those stay with their existing
//      owners (log-call route, callAttempts.ts, buyerLifecycle.ts) so the
//      follow-up completion gate and the ghosting cycle keep their exact
//      current semantics.
//   3. CallLog.phoneNumber is NOT NULL — every path here falls back to
//      "(no number)" rather than failing the write.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome } from "@prisma/client";
import { buyerPrimaryPhone } from "@/lib/buyerLifecycle";

// ── PENDING vocabulary — ONE definition, re-exported ────────────────────────
//
// The canonical set lives in lib/ghosting.ts and is RE-EXPORTED here, never
// re-declared. This file briefly carried its own copy (written in parallel with
// ghosting.ts); they agreed, but two definitions of "pending" that can drift
// apart is precisely how the 👻 ghosting engine would start counting taps as
// attempts again — a silent, data-corrupting divergence.
//
// The dependency direction is forced and must not be inverted: ghosting.ts is
// deliberately prisma-free (it is imported by lib/leadFilterWhere.ts, which is
// shared with the CLIENT filter panel), whereas this module imports `prisma`
// and `buyerLifecycle`. Importing this file from ghosting.ts would drag the
// Prisma client into the browser bundle and break the build.
//
// Array covariance makes the re-export safe where a Prisma `CallOutcome[]` is
// expected: Array<"INITIATED"|"RINGING"> is assignable to CallOutcome[].
export { PENDING_CALL_OUTCOMES, isPendingCall } from "@/lib/ghosting";
import { PENDING_CALL_OUTCOMES, isPendingCall } from "@/lib/ghosting";

/** String form, for `where: { outcome: { notIn: PENDING_CALL_OUTCOME_VALUES } }`
 *  in surfaces that hold outcomes as plain strings. Thin derivation — NOT a
 *  second source of truth. */
export const PENDING_CALL_OUTCOME_VALUES: string[] = PENDING_CALL_OUTCOMES.map(String);

/** Inverse of isPendingCall — the attempt actually resolved. */
export function isTerminalCall(outcome: string | null | undefined): boolean {
  return !!outcome && !isPendingCall(outcome);
}

/** Re-exported from ghosting.ts (defined there to break the buyerLifecycle
 *  import cycle — see the note at its declaration). ONE window, shared by the
 *  lead path here and the buyer path in buyerLifecycle.ts. */
export { PENDING_RESOLVE_WINDOW_MIN } from "@/lib/ghosting";
import { PENDING_RESOLVE_WINDOW_MIN } from "@/lib/ghosting";

/**
 * Double-tap guard for startCall. A beacon can fire twice for ONE dial (agent
 * taps Call again because the dialer was slow, a re-render re-fires onClick, a
 * flaky mobile network retries the beacon). Within this window the existing
 * PENDING row is REUSED instead of a second row being created — this is part of
 * the one-dial-one-row guarantee, not an optimisation.
 */
export const DIAL_DEDUPE_WINDOW_SEC = 60;

// ── Types ───────────────────────────────────────────────────────────────────

export interface StartCallInput {
  leadId?: string | null;
  buyerId?: string | null;
  /** Acting agent. Null only for an unattributable telephony event. */
  userId: string | null;
  /** Omit to resolve from the linked record. */
  phoneNumber?: string | null;
  direction?: CallDirection;
  /** Defaults to now. */
  at?: Date;
}

export interface StartCallResult {
  /** Null when the write failed — callers treat this as fire-and-forget. */
  callLogId: string | null;
  /** True when an existing PENDING row was reused (double-tap guard). */
  reused: boolean;
}

export interface TransitionPatch {
  durationSec?: number | null;
  notes?: string | null;
  endedAt?: Date | null;
  recordingUrl?: string | null;
  direction?: CallDirection;
  /**
   * Set true to permit a TERMINAL → TERMINAL rewrite (a genuine correction of a
   * mis-logged outcome). Without it, such a move is refused so a stray retry can
   * never silently overwrite a resolved call.
   */
  correction?: boolean;
}

export interface TransitionResult {
  ok: boolean;
  callLogId: string;
  /** False when the move was a no-op or refused as illegal. */
  applied: boolean;
  reason?: "not-found" | "no-op" | "illegal-transition" | "error";
  from?: CallOutcome;
  to?: CallOutcome;
}

export interface ResolveOrCreateInput {
  leadId?: string | null;
  buyerId?: string | null;
  userId: string | null;
  /** The TERMINAL outcome being recorded. */
  outcome: CallOutcome;
  durationSec?: number | null;
  notes?: string | null;
  phoneNumber?: string | null;
  direction?: CallDirection;
  /** Call start time — used for a freshly created row. Defaults to now. */
  at?: Date;
  endedAt?: Date | null;
  recordingUrl?: string | null;
}

export interface ResolveOrCreateResult {
  callLogId: string | null;
  /** True = we claimed the dial's PENDING row (no duplicate was created). */
  resolvedPending: boolean;
}

// ── Phone resolution ────────────────────────────────────────────────────────

/**
 * Best-effort phone for the CallLog row. Never throws, never returns empty —
 * CallLog.phoneNumber is NOT NULL and an unresolvable number must not stop a
 * call being recorded. Lead phones are stored verbatim (matching every existing
 * row written by the log-call route); buyer phones go through the shared
 * buyerPrimaryPhone() JSON-array parser.
 */
async function resolvePhoneNumber(input: {
  leadId?: string | null;
  buyerId?: string | null;
  phoneNumber?: string | null;
}): Promise<string> {
  const explicit = String(input.phoneNumber ?? "").trim();
  if (explicit) return explicit;
  try {
    if (input.leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: input.leadId },
        select: { phone: true },
      });
      const p = String(lead?.phone ?? "").trim();
      if (p) return p;
    } else if (input.buyerId) {
      const buyer = await prisma.buyerRecord.findUnique({
        where: { id: input.buyerId },
        select: { phones: true },
      });
      if (buyer) return buyerPrimaryPhone(buyer.phones);
    }
  } catch {
    /* fall through to the placeholder — never break the call flow */
  }
  return "(no number)";
}

/** Record-identity fragment for a pending-row lookup. Null when the call is
 *  unlinked (a telephony row with no CRM match) — such rows are never claimed,
 *  because "the same record" cannot be established. */
function recordWhere(input: { leadId?: string | null; buyerId?: string | null }):
  | { leadId: string }
  | { buyerId: string }
  | null {
  if (input.leadId) return { leadId: input.leadId };
  if (input.buyerId) return { buyerId: input.buyerId };
  return null;
}

/**
 * The most recent claimable PENDING row for this (record, user), or null.
 *
 * Scoping rules:
 *   • record   — leadId OR buyerId must match exactly. An unlinked call is
 *                never claimed.
 *   • user     — the SAME agent. Two agents dialling the same lead each own
 *                their own row, so one never steals the other's dial. When
 *                userId is null (unattributed telephony event) we match on the
 *                record alone, which is the only sane behaviour there.
 *   • time     — within PENDING_RESOLVE_WINDOW_MIN, so a stale dial from hours
 *                ago is never retro-attached to an unrelated call.
 *   • newest first — if an agent somehow has two pending rows, the latest dial
 *                is the one this outcome belongs to.
 */
async function findClaimablePending(input: {
  leadId?: string | null;
  buyerId?: string | null;
  userId: string | null;
  now: Date;
  windowMin?: number;
}): Promise<{ id: string; outcome: CallOutcome } | null> {
  const rec = recordWhere(input);
  if (!rec) return null;
  const windowMin = input.windowMin ?? PENDING_RESOLVE_WINDOW_MIN;
  const since = new Date(input.now.getTime() - windowMin * 60_000);
  try {
    const row = await prisma.callLog.findFirst({
      where: {
        ...rec,
        ...(input.userId ? { userId: input.userId } : {}),
        outcome: { in: PENDING_CALL_OUTCOMES },
        startedAt: { gte: since },
      },
      orderBy: { startedAt: "desc" },
      select: { id: true, outcome: true },
    });
    return row;
  } catch (e) {
    console.error("[callLogService] pending lookup failed", e);
    return null;
  }
}

// ── 1. startCall — the dial beacon's write ──────────────────────────────────

/**
 * Record that a dial was PLACED. Writes ONE CallLog at outcome=INITIATED and
 * returns its id so the UI can later resolve it.
 *
 * NEVER THROWS. A failure returns { callLogId: null } and is logged — the
 * agent's `tel:` navigation must never be blocked by our bookkeeping.
 *
 * Double-tap safe: an existing PENDING row for the same (record, user) inside
 * DIAL_DEDUPE_WINDOW_SEC is reused rather than duplicated.
 */
export async function startCall(input: StartCallInput): Promise<StartCallResult> {
  try {
    if (!input.leadId && !input.buyerId) {
      console.error("[callLogService.startCall] refused — no leadId or buyerId");
      return { callLogId: null, reused: false };
    }
    const now = input.at ?? new Date();

    // Double-tap guard — reuse a just-created pending row for the same dial.
    const existing = await findClaimablePending({
      leadId: input.leadId,
      buyerId: input.buyerId,
      userId: input.userId,
      now,
      windowMin: DIAL_DEDUPE_WINDOW_SEC / 60,
    });
    if (existing) return { callLogId: existing.id, reused: true };

    const phoneNumber = await resolvePhoneNumber(input);
    const row = await prisma.callLog.create({
      data: {
        leadId: input.leadId ?? null,
        buyerId: input.buyerId ?? null,
        userId: input.userId,
        direction: input.direction ?? CallDirection.OUTBOUND,
        phoneNumber,
        outcome: CallOutcome.INITIATED,
        startedAt: now,
      },
      select: { id: true },
    });
    return { callLogId: row.id, reused: false };
  } catch (e) {
    // Swallow — a dial must always go through, logged or not.
    console.error("[callLogService.startCall] failed", e);
    return { callLogId: null, reused: false };
  }
}

// ── 2. transitionCall — move the SAME row forward ───────────────────────────

/**
 * Advance an existing CallLog to `nextOutcome`, updating that ONE row.
 * Enforces the legal-transition table documented at the top of this file.
 * Never creates a row. Never throws.
 *
 * `endedAt` / `durationSec` are stamped when the row becomes terminal: endedAt
 * defaults to now (a terminal call has, by definition, ended) and durationSec
 * is written only when a positive value is supplied.
 */
export async function transitionCall(
  callLogId: string,
  nextOutcome: CallOutcome,
  patch: TransitionPatch = {},
): Promise<TransitionResult> {
  try {
    const current = await prisma.callLog.findUnique({
      where: { id: callLogId },
      select: { id: true, outcome: true, endedAt: true, durationSec: true, notes: true },
    });
    if (!current) {
      return { ok: false, callLogId, applied: false, reason: "not-found" };
    }

    const from = current.outcome;
    const fromPending = isPendingCall(from);
    const toPending = isPendingCall(nextOutcome);

    // No-op: same outcome and nothing new to write. Idempotent retries land here.
    const hasPayload =
      (patch.durationSec != null && patch.durationSec > 0) ||
      (patch.notes != null && patch.notes !== current.notes) ||
      patch.endedAt != null ||
      patch.recordingUrl != null ||
      patch.direction != null;
    if (from === nextOutcome && !hasPayload) {
      return { ok: true, callLogId, applied: false, reason: "no-op", from, to: nextOutcome };
    }

    // TERMINAL → PENDING is never legal: a resolved call cannot be un-resolved.
    if (!fromPending && toPending) {
      return { ok: false, callLogId, applied: false, reason: "illegal-transition", from, to: nextOutcome };
    }
    // TERMINAL → TERMINAL only as an explicit correction.
    if (!fromPending && !toPending && from !== nextOutcome && !patch.correction) {
      return { ok: false, callLogId, applied: false, reason: "illegal-transition", from, to: nextOutcome };
    }

    const becomesTerminal = !toPending;
    const duration =
      patch.durationSec != null && isFinite(patch.durationSec) && patch.durationSec > 0
        ? Math.floor(patch.durationSec)
        : undefined;

    await prisma.callLog.update({
      where: { id: callLogId },
      data: {
        outcome: nextOutcome,
        ...(patch.direction ? { direction: patch.direction } : {}),
        ...(patch.notes != null && patch.notes !== "" ? { notes: patch.notes } : {}),
        ...(patch.recordingUrl ? { recordingUrl: patch.recordingUrl } : {}),
        ...(duration != null ? { durationSec: duration } : {}),
        // A terminal call has ended. Respect an explicit endedAt; otherwise
        // stamp now, but never clobber an endedAt already on the row.
        ...(becomesTerminal
          ? { endedAt: patch.endedAt ?? current.endedAt ?? new Date() }
          : {}),
      },
    });
    return { ok: true, callLogId, applied: true, from, to: nextOutcome };
  } catch (e) {
    console.error("[callLogService.transitionCall] failed", callLogId, e);
    return { ok: false, callLogId, applied: false, reason: "error" };
  }
}

// ── 3. resolveOrCreateCall — THE anti-duplicate guarantee ───────────────────

/**
 * Record a TERMINAL call outcome without ever duplicating the dial's row.
 *
 *   • A claimable PENDING row for this (record, user) → TRANSITION it.
 *     The agent tapped Call (row created at INITIATED) and is now logging the
 *     result: the SAME row becomes CONNECTED/NOT_PICKED/… — one dial, one row.
 *   • No claimable PENDING row → CREATE a terminal row directly.
 *     Covers a call the agent made outside the CRM (from their own phone book,
 *     an inbound call, a back-dated log) — still exactly one row.
 *
 * Use this from EVERY path that records a finished call. Never call
 * prisma.callLog.create() for a manually-logged call again.
 */
export async function resolveOrCreateCall(
  input: ResolveOrCreateInput,
): Promise<ResolveOrCreateResult> {
  const now = input.at ?? new Date();
  try {
    const pending = await findClaimablePending({
      leadId: input.leadId,
      buyerId: input.buyerId,
      userId: input.userId,
      now,
    });

    if (pending) {
      const res = await transitionCall(pending.id, input.outcome, {
        durationSec: input.durationSec,
        notes: input.notes,
        endedAt: input.endedAt ?? now,
        recordingUrl: input.recordingUrl,
        direction: input.direction,
      });
      // A refused transition (illegal move) must still not lose the call — fall
      // through to creating a row so the outcome is never silently dropped.
      if (res.ok) return { callLogId: pending.id, resolvedPending: true };
    }

    const phoneNumber = await resolvePhoneNumber(input);
    const duration =
      input.durationSec != null && isFinite(input.durationSec) && input.durationSec > 0
        ? Math.floor(input.durationSec)
        : undefined;
    const row = await prisma.callLog.create({
      data: {
        leadId: input.leadId ?? null,
        buyerId: input.buyerId ?? null,
        userId: input.userId,
        direction: input.direction ?? CallDirection.OUTBOUND,
        phoneNumber,
        outcome: input.outcome,
        notes: input.notes || undefined,
        durationSec: duration,
        startedAt: now,
        endedAt: input.endedAt ?? undefined,
        recordingUrl: input.recordingUrl ?? undefined,
      },
      select: { id: true },
    });
    return { callLogId: row.id, resolvedPending: false };
  } catch (e) {
    console.error("[callLogService.resolveOrCreateCall] failed", e);
    return { callLogId: null, resolvedPending: false };
  }
}

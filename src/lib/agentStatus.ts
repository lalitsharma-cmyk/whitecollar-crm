import "server-only";
// ────────────────────────────────────────────────────────────────────────────
// Agent field-movement status — core logic.
//
// Agents tap a phone button to log where they are. Six kinds:
//   HERE                 → arrival / check-in   (ALSO marks Attendance self-check-in)
//   LEAVING_OFFICE       → left for the day      (standalone point event)
//   GOING_MEETING        → start of a meeting    (opens a pair)
//   RETURNED_MEETING     → end   of the meeting  (closes the pair → duration)
//   GOING_SITE_VISIT     → start of a site visit (opens a pair)
//   RETURNED_SITE_VISIT  → end   of the site visit (closes the pair → duration)
//
// PAIRING — a "Returned" tap looks up the latest still-OPEN matching "Going"
// row for that user (endedAt IS NULL), computes the minutes between, and writes
// the duration onto BOTH rows: the opening "Going" row gets endedAt+durationMin
// (so it's no longer "open"), and the closing "Returned" row stores the same
// durationMin + pairedEventId. "Currently OUT" = any GOING_* row with endedAt
// still null.
//
// MANAGER NOTIFY — every event notifies Lalit (super-admin) via notify(): in-app
// bell + Web Push, INFO severity (non-intrusive — the bell's sound logic gives
// INFO a soft tone, distinct from the LEAD_ASSIGNED "new lead" alert). Duration
// is included on "Returned" messages. The acting agent is never notified.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { AgentStatusKind } from "@prisma/client";
import { notify } from "@/lib/notify";
import { formatLeadName } from "@/lib/leadName";

export const AGENT_STATUS_KINDS: AgentStatusKind[] = [
  "HERE",
  "LEAVING_OFFICE",
  "GOING_MEETING",
  "RETURNED_MEETING",
  "GOING_SITE_VISIT",
  "RETURNED_SITE_VISIT",
];

export function isAgentStatusKind(v: unknown): v is AgentStatusKind {
  return typeof v === "string" && (AGENT_STATUS_KINDS as string[]).includes(v);
}

// Which "Going" kind a "Returned" kind closes. Non-Returned kinds map to null.
const RETURN_OPENS: Partial<Record<AgentStatusKind, AgentStatusKind>> = {
  RETURNED_MEETING: "GOING_MEETING",
  RETURNED_SITE_VISIT: "GOING_SITE_VISIT",
};

// Which kinds are "going out" (open a pair → contribute to "currently OUT").
const GOING_KINDS: AgentStatusKind[] = ["GOING_MEETING", "GOING_SITE_VISIT"];

export function isGoingKind(k: AgentStatusKind): boolean {
  return GOING_KINDS.includes(k);
}

/** Minutes between two instants, rounded to the nearest minute, floored at 0. */
export function minutesBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.round(ms / 60_000));
}

/** Human "1h 5m" / "45m" / "<1m" from minutes. */
export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return "";
  if (min <= 0) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Short, friendly label for each kind (UI + notification copy).
export const STATUS_LABEL: Record<AgentStatusKind, string> = {
  HERE: "I Am Here",
  LEAVING_OFFICE: "Leaving Office",
  GOING_MEETING: "Going For Meeting",
  RETURNED_MEETING: "Returned From Meeting",
  GOING_SITE_VISIT: "Going For Site Visit",
  RETURNED_SITE_VISIT: "Returned From Site Visit",
};

// Verb phrase used in the manager notification, e.g. "Tanuj <phrase>".
function notifPhrase(kind: AgentStatusKind, durationMin: number | null): string {
  switch (kind) {
    case "HERE":
      return "checked in (I Am Here)";
    case "LEAVING_OFFICE":
      return "left the office";
    case "GOING_MEETING":
      return "started a meeting";
    case "GOING_SITE_VISIT":
      return "started a site visit";
    case "RETURNED_MEETING":
      return durationMin != null ? `returned from meeting · ${fmtDuration(durationMin)}` : "returned from meeting";
    case "RETURNED_SITE_VISIT":
      return durationMin != null ? `returned from site visit · ${fmtDuration(durationMin)}` : "returned from site visit";
  }
}

export interface RecordedStatus {
  id: string;
  status: AgentStatusKind;
  startedAt: Date;
  endedAt: Date | null;
  durationMin: number | null;
  pairedEventId: string | null;
}

/**
 * Resolve the manager (Lalit) for status notifications. Prefers the super-admin
 * (Lalit Sharma), falling back to any active ADMIN. Returns null if none —
 * caller then just skips the notify (the event is still recorded).
 */
export async function resolveManagerUserId(): Promise<string | null> {
  const sa = await prisma.user.findFirst({
    where: { isSuperAdmin: true, active: true },
    select: { id: true },
  });
  if (sa) return sa.id;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/** The user's currently-open "Going" event (out on a meeting / site visit), if any. */
export async function openGoingEvent(userId: string) {
  return prisma.agentStatusEvent.findFirst({
    where: { userId, status: { in: GOING_KINDS }, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
}

/** [start, end) UTC bounds of "today" in IST. Shared by the HERE-once guard. */
function istDayWindowUtc(): { start: Date; end: Date } {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istMidnight = new Date(Date.now() + istOffsetMs);
  istMidnight.setUTCHours(0, 0, 0, 0);
  const start = new Date(istMidnight.getTime() - istOffsetMs);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * The user's HERE (check-in) event for today (IST), if any. Used to enforce the
 * once-per-day "I Am Here" rule (the button locks + a 2nd POST is a no-op).
 */
export async function todaysHereEvent(userId: string): Promise<RecordedStatus | null> {
  const { start, end } = istDayWindowUtc();
  const row = await prisma.agentStatusEvent.findFirst({
    where: { userId, status: "HERE", startedAt: { gte: start, lt: end } },
    orderBy: { startedAt: "asc" }, // FIRST check-in of the day wins
  });
  return row
    ? {
        id: row.id,
        status: row.status,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationMin: row.durationMin,
        pairedEventId: row.pairedEventId,
      }
    : null;
}

/** Today's (IST) status events for a user, newest first — for the history list. */
export async function todaysEvents(userId: string): Promise<RecordedStatus[]> {
  // IST day window expressed in UTC.
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowIstMs = Date.now() + istOffsetMs;
  const istMidnight = new Date(nowIstMs);
  istMidnight.setUTCHours(0, 0, 0, 0);
  const dayStartUtc = new Date(istMidnight.getTime() - istOffsetMs);
  const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);
  const rows = await prisma.agentStatusEvent.findMany({
    where: { userId, startedAt: { gte: dayStartUtc, lt: dayEndUtc } },
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMin: r.durationMin,
    pairedEventId: r.pairedEventId,
  }));
}

export interface LogResult {
  event: RecordedStatus;
  /** Duration computed on a "Returned" tap (null otherwise / if no matching open Going). */
  durationMin: number | null;
  /** True if a "Returned" tap closed a matching open "Going". */
  pairedClosed: boolean;
  /** The user's open Going event AFTER this log (null = not currently out). */
  openGoing: RecordedStatus | null;
  /** True when the call was a no-op (a 2nd HERE for the day) — first event echoed back, nothing written. */
  duplicate?: boolean;
}

/**
 * Core: record a status event for `user`, pairing + duration on "Returned",
 * and notify the manager. Pure DB + notify — auth is the caller's job.
 *
 * @param user        the acting user (id + display name)
 * @param status      which button was tapped
 * @param note        optional free-text note
 * @param onHere      optional hook fired for HERE (used to mark attendance self-check-in)
 */
export async function logAgentStatus(
  user: { id: string; name: string },
  status: AgentStatusKind,
  note?: string | null,
  onHere?: () => Promise<void>,
): Promise<LogResult> {
  const now = new Date();
  let durationMin: number | null = null;
  let pairedClosed = false;
  let pairedEventId: string | null = null;
  // When a "Returned" tap closes a matching open "Going", the Returned row
  // represents the WHOLE meeting/visit span (Going start → now), so its startedAt
  // is the paired Going's startedAt. This keeps durationMin == (endedAt-startedAt)
  // on the Returned row — the `agent-status` invariant — instead of a 0-min span
  // that carried a non-zero paired duration.
  let pairStartedAt: Date | null = null;

  // ── HERE is once-per-day (IST) ──
  // If this user already checked in today, DON'T create a 2nd HERE row, don't
  // re-mark attendance, don't re-notify — echo back the FIRST event so its
  // timestamp is preserved. Makes the endpoint idempotent (button is also locked
  // client-side, but a stale tab / direct POST must not duplicate the check-in).
  if (status === "HERE") {
    const existing = await todaysHereEvent(user.id);
    if (existing) {
      return {
        event: existing,
        durationMin: null,
        pairedClosed: false,
        openGoing: await (async () => {
          const o = await openGoingEvent(user.id);
          return o
            ? { id: o.id, status: o.status, startedAt: o.startedAt, endedAt: o.endedAt, durationMin: o.durationMin, pairedEventId: o.pairedEventId }
            : null;
        })(),
        duplicate: true,
      };
    }
  }

  // ── "Returned" → close the matching open "Going" ──
  const opensKind = RETURN_OPENS[status];
  if (opensKind) {
    const open = await prisma.agentStatusEvent.findFirst({
      where: { userId: user.id, status: opensKind, endedAt: null },
      orderBy: { startedAt: "desc" },
    });
    if (open) {
      durationMin = minutesBetween(open.startedAt, now);
      pairedEventId = open.id;
      pairStartedAt = open.startedAt;
      pairedClosed = true;
      // Back-fill the opening row so it's no longer "open" and carries the duration.
      await prisma.agentStatusEvent.update({
        where: { id: open.id },
        data: { endedAt: now, durationMin },
      });
    }
  }

  // ── Create the event row ──
  // GOING_* rows are OPEN (endedAt null). A PAIRED "Returned" row spans the
  // meeting/visit (startedAt = paired Going start → endedAt = now) so
  // durationMin == endedAt-startedAt. Unpaired "Returned" + point events are a
  // zero-span instant at `now` (durationMin stays null). None count as "out".
  const isGoing = GOING_KINDS.includes(status);
  const created = await prisma.agentStatusEvent.create({
    data: {
      userId: user.id,
      status,
      startedAt: pairStartedAt ?? now,
      endedAt: isGoing ? null : now,
      durationMin,
      pairedEventId,
      note: note?.trim() || null,
    },
  });

  // ── HERE side-effect: mark the existing Attendance self-check-in (no dup path) ──
  if (status === "HERE" && onHere) {
    await onHere().catch(() => {});
  }

  // ── Notify the manager (never the acting agent) ──
  try {
    const managerId = await resolveManagerUserId();
    if (managerId && managerId !== user.id) {
      const display = formatLeadName(user.name) || user.name;
      const phrase = notifPhrase(status, durationMin);
      await notify({
        userId: managerId,
        kind: "AGENT_STATUS",
        severity: "INFO", // soft / operational — distinct from lead & SLA alerts
        title: `${display} ${phrase}`,
        body: note?.trim()
          ? `Note: ${note.trim()}`
          : `${STATUS_LABEL[status]} · ${display}`,
        linkUrl: "/admin/field-status",
        email: false, // operational visibility — never email-spam the manager
      });
    }
  } catch {
    /* best-effort — a notify failure must never block the agent's check-in */
  }

  // Current open-going state after this action.
  const openGoing = isGoing
    ? {
        id: created.id,
        status: created.status,
        startedAt: created.startedAt,
        endedAt: created.endedAt,
        durationMin: created.durationMin,
        pairedEventId: created.pairedEventId,
      }
    : await (async () => {
        const o = await openGoingEvent(user.id);
        return o
          ? { id: o.id, status: o.status, startedAt: o.startedAt, endedAt: o.endedAt, durationMin: o.durationMin, pairedEventId: o.pairedEventId }
          : null;
      })();

  return {
    event: {
      id: created.id,
      status: created.status,
      startedAt: created.startedAt,
      endedAt: created.endedAt,
      durationMin: created.durationMin,
      pairedEventId: created.pairedEventId,
    },
    durationMin,
    pairedClosed,
    openGoing,
  };
}

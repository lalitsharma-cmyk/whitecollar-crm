// ────────────────────────────────────────────────────────────────────────────
// Customer layer — STANDARDIZED timeline event taxonomy (Step 1 foundation).
//
// The SINGLE source of truth for every event the customer-360 master timeline can
// ever show. The complete set is LOCKED here NOW — even though some events only
// begin firing in later steps (AI, merge/rollback, soft-delete/restore, explicit
// status/stage changes) — so the timeline contract never changes shape later and
// every surface (loader, filter chips, future writers) agrees on one vocabulary.
//
// PURE: no "server-only", no DB, no I/O — importable into the read-only
// regression harness and unit-testable. The loader (query.ts) maps raw Activity
// rows + link/unlink audit rows onto these events; the 360 view filters by the
// chip groups below (Rule 4 — FILTER, never remove; default = All).
// ────────────────────────────────────────────────────────────────────────────

/**
 * The complete, locked taxonomy of customer-timeline event types. Stored as a
 * const object (not a TS enum) so the values are plain strings that survive
 * serialization to the client and can key the immutable audit/UI without an enum
 * runtime. Order here is the canonical lifecycle order.
 */
export const TIMELINE_EVENT = {
  // ── Customer-layer lifecycle (link service + audit) ──
  CUSTOMER_CREATED: "CUSTOMER_CREATED",
  CUSTOMER_LINKED: "CUSTOMER_LINKED",
  CUSTOMER_UNLINKED: "CUSTOMER_UNLINKED",
  // ── Enquiry (lead) lifecycle ──
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  LEAD_REASSIGNED: "LEAD_REASSIGNED",
  // ── Follow-ups ──
  FOLLOWUP_CREATED: "FOLLOWUP_CREATED",
  FOLLOWUP_COMPLETED: "FOLLOWUP_COMPLETED",
  FOLLOWUP_RESCHEDULED: "FOLLOWUP_RESCHEDULED",
  // ── Conversations / touches ──
  CALL_LOGGED: "CALL_LOGGED",
  WHATSAPP_LOGGED: "WHATSAPP_LOGGED",
  NOTE_ADDED: "NOTE_ADDED",
  // ── Status / stage transitions ──
  STATUS_CHANGED: "STATUS_CHANGED",
  STAGE_CHANGED: "STAGE_CHANGED",
  // ── AI ──
  AI_RECOMMENDATION: "AI_RECOMMENDATION",
  AI_SUMMARY: "AI_SUMMARY",
  // ── Data movement ──
  IMPORT: "IMPORT",
  EXPORT: "EXPORT",
  // ── Merge / rollback ──
  MERGE: "MERGE",
  ROLLBACK: "ROLLBACK",
  // ── Soft-delete / restore ──
  SOFT_DELETE: "SOFT_DELETE",
  RESTORE: "RESTORE",
} as const;

/** A single locked timeline event type (one of the 22 above). */
export type TimelineEventType = (typeof TIMELINE_EVENT)[keyof typeof TIMELINE_EVENT];

/** The full ordered list of every event type — handy for tests + exhaustive UI. */
export const ALL_TIMELINE_EVENTS: TimelineEventType[] = Object.values(TIMELINE_EVENT);

/**
 * Display-chip groups for the 360 master-timeline filter (Rule 4 — the chips
 * FILTER, never remove; default = "all"). Several fine-grained event types fold
 * into one human-facing chip (e.g. all three follow-up events → "Follow-ups",
 * link/unlink/merge/rollback → "Merges"). The chip set is intentionally compact;
 * the underlying taxonomy stays fully granular.
 */
export const TIMELINE_CHIP_GROUPS = {
  all: ALL_TIMELINE_EVENTS, // sentinel — "All Events" shows everything
  calls: [TIMELINE_EVENT.CALL_LOGGED],
  whatsapp: [TIMELINE_EVENT.WHATSAPP_LOGGED],
  notes: [TIMELINE_EVENT.NOTE_ADDED],
  assignments: [TIMELINE_EVENT.LEAD_ASSIGNED, TIMELINE_EVENT.LEAD_REASSIGNED],
  followups: [
    TIMELINE_EVENT.FOLLOWUP_CREATED,
    TIMELINE_EVENT.FOLLOWUP_COMPLETED,
    TIMELINE_EVENT.FOLLOWUP_RESCHEDULED,
  ],
  status: [TIMELINE_EVENT.STATUS_CHANGED, TIMELINE_EVENT.STAGE_CHANGED],
  ai: [TIMELINE_EVENT.AI_RECOMMENDATION, TIMELINE_EVENT.AI_SUMMARY],
  data: [TIMELINE_EVENT.IMPORT, TIMELINE_EVENT.EXPORT],
  lifecycle: [TIMELINE_EVENT.CUSTOMER_CREATED, TIMELINE_EVENT.LEAD_CREATED],
  merges: [
    TIMELINE_EVENT.CUSTOMER_LINKED,
    TIMELINE_EVENT.CUSTOMER_UNLINKED,
    TIMELINE_EVENT.MERGE,
    TIMELINE_EVENT.ROLLBACK,
  ],
  recycle: [TIMELINE_EVENT.SOFT_DELETE, TIMELINE_EVENT.RESTORE],
} as const;

export type TimelineChipKey = keyof typeof TIMELINE_CHIP_GROUPS;

/** Human labels for each chip — drives the 360 filter-chip row. Ordered. */
export const TIMELINE_CHIPS: { key: TimelineChipKey; label: string }[] = [
  { key: "all", label: "All Events" },
  { key: "calls", label: "Calls" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "notes", label: "Notes" },
  { key: "assignments", label: "Assignments" },
  { key: "followups", label: "Follow-ups" },
  { key: "status", label: "Status" },
  { key: "ai", label: "AI" },
  { key: "data", label: "Imports / Exports" },
  { key: "lifecycle", label: "Created" },
  { key: "merges", label: "Merges" },
  { key: "recycle", label: "Recycle" },
];

// Reverse index: event type → the chip key that owns it (computed once).
const EVENT_TO_CHIP: Record<string, TimelineChipKey> = (() => {
  const map: Record<string, TimelineChipKey> = {};
  (Object.keys(TIMELINE_CHIP_GROUPS) as TimelineChipKey[]).forEach((chip) => {
    if (chip === "all") return; // "all" is the catch-all sentinel, not an owner
    for (const ev of TIMELINE_CHIP_GROUPS[chip]) map[ev] = chip;
  });
  return map;
})();

/** Which filter chip a given event type belongs to (defaults to "lifecycle"). */
export function chipForEvent(ev: TimelineEventType): TimelineChipKey {
  return EVENT_TO_CHIP[ev] ?? "lifecycle";
}

/**
 * True when an event passes the active filter chip. "all" always passes — events
 * are FILTERED, never removed. Anything else passes only when the event maps to
 * that chip's group.
 */
export function eventMatchesChip(ev: TimelineEventType, chip: TimelineChipKey): boolean {
  if (chip === "all") return true;
  return chipForEvent(ev) === chip;
}

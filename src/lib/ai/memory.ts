// AI Sales OS — entity memory compaction (M6), PURE + unit-testable. Reduces a raw
// list of recent events (remarks, calls, status changes, prior AI decisions) for one
// entity into a compact, most-recent-first memory the Reason layer can carry cheaply.
// Deterministic — no LLM. The server layer (memoryService) supplies the raw events.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
export type MemoryKind = "remark" | "call" | "status" | "ai_decision";

export interface MemoryEvent {
  at: string;        // ISO timestamp (string keeps this pure + tests deterministic)
  kind: MemoryKind;
  summary: string;
}

export interface EntityMemory {
  entityId: string;
  recent: MemoryEvent[];      // most recent first, capped
  priorAiActions: string[];   // de-duplicated summaries of prior ai_decision events
  digest: string;             // one-line human compaction
  eventCount: number;         // total events seen (before the cap)
}

/** Compact raw events into an EntityMemory. Most recent first, capped at `cap`. */
export function compactMemory(entityId: string, events: MemoryEvent[], cap = 8): EntityMemory {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // desc
  const recent = sorted.slice(0, cap);

  const priorAiActions = Array.from(
    new Set(sorted.filter((e) => e.kind === "ai_decision").map((e) => e.summary)),
  );

  const last = sorted[0];
  const counts = sorted.reduce<Record<MemoryKind, number>>(
    (acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc),
    { remark: 0, call: 0, status: 0, ai_decision: 0 },
  );

  const digest = sorted.length === 0
    ? "No prior activity."
    : `${sorted.length} event(s): ${counts.call} call(s), ${counts.remark} remark(s), ` +
      `${counts.status} status change(s), ${counts.ai_decision} AI decision(s). ` +
      `Latest: ${last.summary}.`;

  return { entityId, recent, priorAiActions, digest, eventCount: sorted.length };
}

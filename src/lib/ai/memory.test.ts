// AI Sales OS — M6 memory + knowledge local validation (pure). tsx.
import { compactMemory, type MemoryEvent } from "./memory";
import { retrieveKnowledge, KNOWLEDGE_BASE } from "./knowledge";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

// ── Memory compaction ──────────────────────────────────────────────────────
const events: MemoryEvent[] = [
  { at: "2026-06-28T10:00:00Z", kind: "call", summary: "Discussed 2BR budget" },
  { at: "2026-07-01T09:00:00Z", kind: "remark", summary: "Wants sea view" },
  { at: "2026-06-30T12:00:00Z", kind: "ai_decision", summary: "Suggested follow-up today" },
  { at: "2026-07-02T08:00:00Z", kind: "status", summary: "Moved to Negotiation" },
  { at: "2026-06-29T12:00:00Z", kind: "ai_decision", summary: "Suggested follow-up today" }, // dup summary
];

const mem = compactMemory("L1", events, 3);
ok("most recent event first", mem.recent[0]?.summary === "Moved to Negotiation");
ok("respects cap of 3", mem.recent.length === 3);
ok("eventCount is total (pre-cap)", mem.eventCount === 5);
ok("prior AI actions de-duplicated", mem.priorAiActions.length === 1 && mem.priorAiActions[0] === "Suggested follow-up today");
ok("digest names the latest event", mem.digest.includes("Moved to Negotiation"));
ok("digest counts 2 AI decisions", mem.digest.includes("2 AI decision"));
ok("empty memory is safe", (() => { const e = compactMemory("L2", []); return e.digest === "No prior activity." && e.recent.length === 0 && e.eventCount === 0; })());

// ── Knowledge retrieval ────────────────────────────────────────────────────
const budget = retrieveKnowledge("client says it is too expensive, budget objection");
ok("budget query retrieves the budget-objection entry", budget[0]?.entry.id === "kb.objection.budget");

const market = retrieveKnowledge("can I match an India buyer to a Dubai AED property?");
ok("market query retrieves segregation rule", market.some((r) => r.entry.id === "kb.market.segregation"));

const fresh = retrieveKnowledge("new uncontacted lead first call", { limit: 2 });
ok("fresh query retrieves the SLA entry", fresh[0]?.entry.id === "kb.sla.fresh");
ok("limit is respected", fresh.length <= 2);

ok("irrelevant query → no matches", retrieveKnowledge("weather forecast tomorrow").length === 0);
ok("empty query → no matches", retrieveKnowledge("").length === 0);
ok("results sorted by score desc", (() => { const r = retrieveKnowledge("followup overdue pipeline market"); return r.every((x, i) => i === 0 || r[i - 1].score >= x.score); })());
ok("every KB entry has tags + market", KNOWLEDGE_BASE.every((e) => e.tags.length > 0 && ["India", "UAE", "both"].includes(e.market)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

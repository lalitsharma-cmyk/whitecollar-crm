// AI Sales OS — M0 local validation (pure, no deps). Run:
//   npx tsx src/lib/ai/analyze.test.ts   (from the AI worktree, or via absolute path)
import { analyzeLeadContext, type AiLeadContext } from "./analyze";
import { getEngine, resolveEngine, mockEngine } from "./engine";

const base: AiLeadContext = {
  id: "L1", name: "Test Client", currentStatus: "Follow Up", isTerminal: false,
  followupOverdue: false, followupMissing: false, isHot: false, contactedToday: false,
  ownerId: "u1", daysSinceLastTouch: 1,
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}`); }
const has = (r: ReturnType<typeof analyzeLeadContext>, id: string) => r.detections.some((d) => d.id === id);

// terminal → no action, stops at analyze
const term = analyzeLeadContext({ ...base, isTerminal: true });
ok("terminal → no detections, stage=analyze", term.detections.length === 0 && term.reachedStage === "analyze");

// overdue → risk + a call suggestion (read-only)
const overdue = analyzeLeadContext({ ...base, followupOverdue: true });
ok("overdue → 'followup-overdue' risk", has(overdue, "followup-overdue"));
ok("overdue → a call.today suggestion, mutation null", overdue.suggestions.some((s) => s.action === "call.today" && s.mutation === null));

// hot + not contacted → opportunity
const hot = analyzeLeadContext({ ...base, isHot: true, contactedToday: false });
ok("hot uncontacted → 'hot-uncontacted' opportunity", has(hot, "hot-uncontacted"));

// hot but contacted today → NO hot-uncontacted opportunity
const hotDone = analyzeLeadContext({ ...base, isHot: true, contactedToday: true });
ok("hot but contacted → no hot-uncontacted", !has(hotDone, "hot-uncontacted"));

// missing follow-up → risk + set-followup suggestion
const missing = analyzeLeadContext({ ...base, followupMissing: true });
ok("missing → 'followup-missing' + set-followup", has(missing, "followup-missing") && missing.suggestions.some((s) => s.action === "followup.set"));

// ghosting (>7d untouched) → risk
const ghost = analyzeLeadContext({ ...base, daysSinceLastTouch: 12 });
ok("untouched 12d → 'ghosting' risk", has(ghost, "ghosting"));

// every suggestion is read-only (mutation null) — the pipeline never proposes a write at M0
const allReadOnly = [overdue, hot, missing, ghost].every((r) => r.suggestions.every((s) => s.mutation === null));
ok("ALL suggestions are read-only (mutation null)", allReadOnly);

// engine: production-safe resolver degrades to the deterministic mock when no LLM key
// is configured (M7); strict getEngine() surfaces a misconfig instead of silently no-op.
(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith("AI_")) delete process.env[k];
  const e = resolveEngine();
  ok("resolveEngine degrades to mock (no key configured)", e.name === "mock");
  const r1 = await mockEngine.complete({ user: "hello", context: { a: 1 } });
  const r2 = await mockEngine.complete({ user: "hello", context: { a: 1 } });
  ok("mock engine is deterministic", r1.text === r2.text && r1.engine === "mock");
  let threw = false;
  try { getEngine("gemini"); } catch { threw = true; }
  ok("strict getEngine('gemini') throws without a key, never silent no-op", threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();

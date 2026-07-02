// ────────────────────────────────────────────────────────────────────────────
// AI Sales OS — REALISTIC-SCENARIO QA harness (Agent 4). Runs the AI pipeline on
// the deterministic MOCK engine against believable WCR CRM cases and asserts the
// owner's standards hold EVEN without an LLM key:
//   • confidence ratings present + sensible on every detection/suggestion
//   • explanations human-readable + explainable, and NO "[mock]" text ever leaks
//   • suggestions actionable (name a next action) and read-only by construction
//   • apply mutations whitelisted + reversible + survive the safety gate
//   • currency/market never mixed (India INR vs Dubai AED); cross-market never matches
//
// PURE — no prisma, no network. Run:  npx tsx src/lib/ai/scenarios.test.ts
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
// ────────────────────────────────────────────────────────────────────────────
import { analyzeLeadContext, type AiLeadContext } from "./analyze";
import { matchBuyersToProperty, type PropertySpec, type BuyerSpec } from "./matching";
import { marketFixSuggestion } from "./dataQuality";
import { planApply } from "./apply";
import { buildDailyDigest, type DigestLead } from "./analytics";
import { buildAmbiguityPrompt } from "./prompts";
import { reasonAboutAmbiguity } from "./reason";
import { mockEngine, type AiEngine, type AiEngineResult } from "./engine";
import type { AiResult, AiConfidence, AiDetection, AiSuggestion } from "./types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

// ── Shared explainability invariants every AiResult must satisfy ─────────────
const CONF: AiConfidence[] = ["high", "medium", "low"];
const looksLikeLeak = (s: string) =>
  /\[mock\]/i.test(s) || /\bTODO\b/.test(s) || /AWAITING/.test(s) || /undefined|null,|NaN/.test(s);

function assertHealthyResult(label: string, r: AiResult) {
  ok(`${label}: explanation is a real human sentence`, r.explanation.length > 20 && /[a-z]/.test(r.explanation));
  ok(`${label}: explanation has NO mock/placeholder leak`, !looksLikeLeak(r.explanation));
  ok(`${label}: every detection carries a valid confidence`, r.detections.every((d: AiDetection) => CONF.includes(d.confidence)));
  ok(`${label}: every detection cites evidence (explainable)`, r.detections.every((d: AiDetection) => d.evidence.length > 0));
  ok(`${label}: every suggestion is actionable (has an action verb id)`, r.suggestions.every((s: AiSuggestion) => s.action.length > 0));
  ok(`${label}: every suggestion carries a valid confidence`, r.suggestions.every((s: AiSuggestion) => CONF.includes(s.confidence)));
  ok(`${label}: every suggestion rationale is real (no leak)`, r.suggestions.every((s: AiSuggestion) => s.rationale.length > 15 && !looksLikeLeak(s.rationale)));
  ok(`${label}: READ-ONLY — no suggestion carries a mutation`, r.suggestions.every((s: AiSuggestion) => s.mutation === null));
}

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Hot lead not contacted in 10 days (the classic "slipping" case).
// Expect: hot-uncontacted opportunity (high) ranked first, a cooling risk, an
// action-first explanation that names the call + the day gap + a confidence.
// ════════════════════════════════════════════════════════════════════════════
const hot10: AiLeadContext = {
  id: "L-hot", name: "Priya Menon", currentStatus: "Interested", isTerminal: false,
  followupOverdue: false, followupMissing: false, isHot: true, contactedToday: false,
  ownerId: "agent-1", daysSinceLastTouch: 10,
};
const r1 = analyzeLeadContext(hot10);
assertHealthyResult("S1 hot-10d", r1);
ok("S1: detects hot-uncontacted opportunity", r1.detections.some((d) => d.id === "hot-uncontacted" && d.kind === "opportunity"));
ok("S1: hot-uncontacted is HIGH confidence", r1.detections.find((d) => d.id === "hot-uncontacted")?.confidence === "high");
ok("S1: hot-uncontacted ranked FIRST (top signal for L4)", r1.detections[0]?.id === "hot-uncontacted");
ok("S1: also flags the 10-day cooling risk", r1.detections.some((d) => d.id === "ghosting"));
ok("S1: top suggestion is call.today, routed to AGENT", r1.suggestions[0]?.action === "call.today" && r1.suggestions[0]?.routeToRole === "AGENT");
ok("S1: explanation names the client", r1.explanation.includes("Priya Menon"));
ok("S1: explanation surfaces a confidence word", /high confidence|medium confidence|low confidence/.test(r1.explanation));
ok("S1: recommendation cites the 10-day gap (grounded in real data)", /10d|10 days/.test(r1.explanation + r1.suggestions.map((s) => s.rationale).join(" ")));

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — Badly stalled lead (32 days, no follow-up set). The cooling risk
// should escalate to HIGH (the gap is unambiguous), and a missing-follow-up risk.
// ════════════════════════════════════════════════════════════════════════════
const stalled32: AiLeadContext = {
  id: "L-stall", name: "Rahul Verma", currentStatus: "Follow Up", isTerminal: false,
  followupOverdue: false, followupMissing: true, isHot: false, contactedToday: false,
  ownerId: "agent-2", daysSinceLastTouch: 32,
};
const r2 = analyzeLeadContext(stalled32);
assertHealthyResult("S2 stalled-32d", r2);
ok("S2: badly-stalled cooling risk is HIGH confidence (>14d)", r2.detections.find((d) => d.id === "ghosting")?.confidence === "high");
ok("S2: 'going cold' framing present in the detection title", r2.detections.some((d) => /going cold/i.test(d.title)));
ok("S2: flags the missing follow-up too", r2.detections.some((d) => d.id === "followup-missing"));
ok("S2: has a set-followup suggestion (schedule the next step)", r2.suggestions.some((s) => s.action === "followup.set"));

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Terminal lead must produce NO action (Read-Only-First + won/closed
// boundary): a Won lead is left alone, explanation is clear, zero suggestions.
// ════════════════════════════════════════════════════════════════════════════
const won: AiLeadContext = {
  id: "L-won", name: "Aisha Khan", currentStatus: "Won", isTerminal: true,
  followupOverdue: true, followupMissing: false, isHot: true, contactedToday: false,
  ownerId: "agent-3", daysSinceLastTouch: 40,
};
const r3 = analyzeLeadContext(won);
ok("S3: terminal → zero detections", r3.detections.length === 0);
ok("S3: terminal → zero suggestions (no action on a closed lead)", r3.suggestions.length === 0);
ok("S3: terminal → stops at 'analyze' stage", r3.reachedStage === "analyze");
ok("S3: terminal explanation is clear + leak-free", /closed\/lost/.test(r3.explanation) && !looksLikeLeak(r3.explanation));

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 4 — Buyer↔Seller matching across markets. A Dubai (AED) property must
// NEVER match an India (INR) buyer — currency-logic hard gate. The in-market,
// in-budget buyer matches with an explainable, high-confidence reason set.
// ════════════════════════════════════════════════════════════════════════════
const dubaiProp: PropertySpec = { id: "P-dxb", market: "UAE", city: "Dubai Marina", configuration: "2BR", askingBudget: 2_600_000 };
const buyers: BuyerSpec[] = [
  // In-market, in-budget, same city + config → strong match.
  { id: "B-dxb-fit", name: "Omar (Dubai)",  market: "UAE",   preferredCity: "Dubai Marina", configuration: "2BR", budgetMin: 2_400_000, budgetMax: 3_000_000 },
  // India buyer whose *number* (2.6 Cr = 26,000,000) sits "within" the AED band if you
  // ignore currency — the classic trap. MUST be excluded by the market gate, never
  // converted or matched.
  { id: "B-ind-trap", name: "Anil (India)", market: "India", preferredCity: "Dubai Marina", configuration: "2BR", budgetMin: 20_000_000, budgetMax: 30_000_000 },
  // Unknown-market buyer → excluded (never guess the market for a match).
  { id: "B-unknown", name: "No Market",     market: null,    preferredCity: "Dubai Marina", configuration: "2BR", budgetMin: 2_400_000, budgetMax: 3_000_000 },
];
const ranked = matchBuyersToProperty(dubaiProp, buyers);
ok("S4: India (INR) buyer NEVER matched to a Dubai (AED) property", !ranked.some((m) => m.buyerId === "B-ind-trap"));
ok("S4: unknown-market buyer excluded (no guessing)", !ranked.some((m) => m.buyerId === "B-unknown"));
ok("S4: the in-market Dubai buyer DOES match", ranked.some((m) => m.buyerId === "B-dxb-fit"));
ok("S4: matched buyer is HIGH confidence", ranked.find((m) => m.buyerId === "B-dxb-fit")?.confidence === "high");
ok("S4: match is explainable — cites market + budget + city", (() => {
  const m = ranked.find((x) => x.buyerId === "B-dxb-fit");
  return ["market", "budget", "city"].every((k) => m?.reasons.some((r) => r.key === k));
})());
ok("S4: reverse gate — an India property matches no UAE buyer", matchBuyersToProperty({ ...dubaiProp, market: "India" }, buyers.filter((b) => b.market === "UAE")).length === 0);

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 5 — Data quality: a lead with a derivable-but-empty market. The AI
// SUGGESTS a reversible market fix (never writes here), and the proposed mutation
// must pass the apply-safety gate (whitelisted, reversible, non-empty, not a no-op).
// ════════════════════════════════════════════════════════════════════════════
// 5a: team-derived (authoritative) → HIGH confidence.
const dq = marketFixSuggestion({ leadId: "L-dq", currentMarket: null, derived: "UAE", basis: { team: "Dubai" } });
ok("S5a: proposes a fix.market suggestion", dq?.action === "fix.market");
ok("S5a: team-derived market fix is HIGH confidence", dq?.confidence === "high");
ok("S5a: routed to ADMIN for approval (not auto-applied)", dq?.routeToRole === "ADMIN");
ok("S5a: mutation is reversible + targets Lead.market", dq?.mutation?.reversible === true && dq?.mutation?.entity === "Lead" && dq?.mutation?.field === "market");
ok("S5a: rationale explains the basis + reversibility", /team \(Dubai\)/.test(dq?.rationale ?? "") && /reversible/i.test(dq?.rationale ?? ""));
ok("S5a: the proposed mutation SURVIVES the apply-safety gate", planApply(dq!.mutation!).ok === true);
// 5b: currency-only signal is softer → MEDIUM confidence.
const dqSoft = marketFixSuggestion({ leadId: "L-dq2", currentMarket: "", derived: "India", basis: { currency: "INR" } });
ok("S5b: currency-only derivation is MEDIUM confidence (softer signal)", dqSoft?.confidence === "medium");
// 5c: not derivable → NO guess (leave in Awaiting Market).
ok("S5c: unclassifiable market → no suggestion (never guess)", marketFixSuggestion({ leadId: "L-dq3", currentMarket: null, derived: null, basis: {} }) === null);
// 5d: the AI may NEVER apply a non-whitelisted field even if it wanted to.
ok("S5d: apply-gate BLOCKS a status write (only 'market' is appliable)", planApply({ entity: "Lead", entityId: "L-dq", field: "currentStatus", from: "Interested", to: "Won", reversible: true }).ok === false);
ok("S5d: apply-gate BLOCKS a name write", planApply({ entity: "Lead", entityId: "L-dq", field: "name", from: "A", to: "B", reversible: true }).ok === false);

// ════════════════════════════════════════════════════════════════════════════
// SCENARIO 6 — Ambiguous decision needing L4 reasoning: a lead where the leading
// signal isn't high-confidence. On the MOCK engine the reason layer must return the
// deterministic fallback verbatim and NEVER surface the "[mock]" echo. A live engine
// (stubbed) is allowed to improve it; an errored engine falls back safely.
// ════════════════════════════════════════════════════════════════════════════
const ambiguous: AiLeadContext = {
  id: "L-amb", name: "Sofia Reyes", currentStatus: "New", isTerminal: false,
  followupOverdue: false, followupMissing: true, isHot: false, contactedToday: false,
  ownerId: "agent-4", daysSinceLastTouch: 3,
};
const rAmb = analyzeLeadContext(ambiguous);
assertHealthyResult("S6 ambiguous", rAmb);
ok("S6: leading detection is NOT high-confidence (genuinely ambiguous)", rAmb.detections[0]?.confidence !== "high");
(async () => {
  // The prompt built for this ambiguity must ground + guardrail + ask for confidence.
  const prompt = buildAmbiguityPrompt({
    question: `For this lead, "${rAmb.detections[0]?.title}" is the leading signal but confidence isn't high. What is the single best next action?`,
    facts: { topSignal: rAmb.detections[0]?.title ?? "", topConfidence: rAmb.detections[0]?.confidence ?? "" },
  });
  ok("S6: ambiguity prompt carries the currency/market guardrail", /never mix or convert currency/i.test(prompt.system ?? ""));
  ok("S6: ambiguity prompt demands explainability + confidence", /confidence \(high\/medium\/low\)/i.test(prompt.user) && /WHY/i.test(prompt.user));
  ok("S6: ambiguity prompt grounds with retrieved WCR knowledge", /Relevant WCR knowledge/.test(prompt.user));
  ok("S6: ambiguity prompt system forbids placeholder/debug text", /\[mock\]/i.test(prompt.system ?? "") && /never output placeholder/i.test(prompt.system ?? ""));

  // MOCK engine → deterministic fallback, no leak.
  const viaMock = await reasonAboutAmbiguity(
    { question: "best next action?" }, rAmb.explanation, mockEngine,
  );
  ok("S6: MOCK reasoning returns the deterministic fallback (usedLlm=false)", viaMock.usedLlm === false && viaMock.text === rAmb.explanation);
  ok("S6: MOCK reasoning output has NO [mock] leak", !looksLikeLeak(viaMock.text));

  // Live engine (stub) → its text is used and improves the answer.
  const live: AiEngine = { name: "gemini", async complete(): Promise<AiEngineResult> { return { text: "Call Sofia today to qualify budget and set a follow-up; confidence: medium.", engine: "gemini:2.5" }; } };
  const viaLive = await reasonAboutAmbiguity({ question: "best next action?" }, rAmb.explanation, live);
  ok("S6: LIVE reasoning is used when a real engine answers (usedLlm=true)", viaLive.usedLlm === true && /Call Sofia/.test(viaLive.text));

  // Errored engine → safe deterministic fallback (CRM never depends on the LLM).
  const boom: AiEngine = { name: "gemini", async complete(): Promise<AiEngineResult> { throw new Error("network down"); } };
  const viaErr = await reasonAboutAmbiguity({ question: "best next action?" }, rAmb.explanation, boom);
  ok("S6: engine error → deterministic fallback, no crash", viaErr.usedLlm === false && viaErr.text === rAmb.explanation);

  // ════════════════════════════════════════════════════════════════════════
  // SCENARIO 7 — Manager digest across a mixed India+UAE pipeline. Numbers add up,
  // severity is sensible, market split is correct, and no INR/AED figure is mixed
  // (the digest counts, never converts). Missing-market leads are surfaced as a risk.
  // ════════════════════════════════════════════════════════════════════════
  const L = (o: Partial<DigestLead>): DigestLead => ({
    id: "x", market: "UAE", ownerId: "A", ownerName: "Agent A",
    isTerminal: false, followupOverdue: false, hotUncontacted: false, stalled: false, freshToday: false, ...o,
  });
  const pipeline: DigestLead[] = [
    L({ id: "1", market: "UAE",   ownerId: "A", ownerName: "Agent A", hotUncontacted: true }),
    L({ id: "2", market: "UAE",   ownerId: "A", ownerName: "Agent A", followupOverdue: true }),
    L({ id: "3", market: "India", ownerId: "B", ownerName: "Agent B", followupOverdue: true }),
    L({ id: "4", market: "India", ownerId: "B", ownerName: "Agent B", stalled: true }),
    L({ id: "5", market: "India", ownerId: "B", ownerName: "Agent B", freshToday: true }),
    L({ id: "6", market: null,    ownerId: "C", ownerName: "Agent C" }),   // missing market
    L({ id: "7", market: "UAE",   ownerId: "C", ownerName: "Agent C", isTerminal: true, followupOverdue: true }), // terminal → excluded
  ];
  const digest = buildDailyDigest(pipeline);
  ok("S7: workable excludes the terminal lead", digest.summary.workable === 6);
  ok("S7: market split is correct (UAE/India/unknown)", digest.summary.byMarket.UAE === 2 && digest.summary.byMarket.India === 3 && digest.summary.byMarket.unknown === 1);
  ok("S7: hot-uncontacted risk surfaces FIRST (most urgent)", digest.topRisks[0]?.includes("hot"));
  ok("S7: flags the missing-market lead as a data-quality risk", digest.topRisks.some((r) => /no market/i.test(r)));
  ok("S7: Agent A (has a hot lead) is HIGH severity", digest.nudges.find((n) => n.ownerId === "A")?.priority === "high");
  ok("S7: Agent A ranks first among nudges", digest.nudges[0]?.ownerId === "A");
  ok("S7: every nudge headline is human-readable + leak-free", digest.nudges.every((n) => n.headline.length > 3 && !looksLikeLeak(n.headline)));
  ok("S7: NO INR/AED figure is emitted (digest counts, never converts)", !digest.topRisks.some((r) => /₹|AED|INR|\bCr\b/.test(r)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();

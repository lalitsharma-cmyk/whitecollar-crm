// AI Sales OS — prompt templates (M7), PURE + unit-testable. Provider-agnostic: builds
// an AiEnginePrompt (system + user) that ANY provider consumes. Grounded with M6 KB
// retrieval so the LLM cites known WCR rules instead of hallucinating, and carries the
// hard currency/market guardrail in the system prompt.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiEnginePrompt } from "./engine";
import { retrieveKnowledge } from "./knowledge";

export const SALES_OS_SYSTEM = [
  "You are the White Collar Realty Sales OS — reasoning like an experienced sales director, coach and data analyst for a real-estate team operating in India (INR) and Dubai/UAE (AED).",
  "Hard rules you must never break:",
  "- Never mix or convert currency across markets: India deals are INR, UAE deals are AED. Never quote one market's price in the other's currency.",
  "- Only match a buyer to a property in the SAME market. An India buyer is never matched to a UAE property, and vice-versa.",
  "- Ground every recommendation in the provided knowledge; do not invent project names, prices, developers, or facts. If the facts don't support a confident answer, say what is missing instead of guessing.",
  "- You ADVISE only — you never take actions, change data, send messages, or claim to have done anything. A human reviews and approves every action.",
  "How to answer (explainability is mandatory — never a black box):",
  "- Lead with the single best next action, stated specifically (who to contact, why now, what to say).",
  "- Briefly say WHY, citing the concrete evidence/facts and the grounded rule you relied on.",
  "- End with your confidence as one of: high, medium, or low — and if it's not high, name the one fact that would raise it.",
  "- Never output placeholder, debug, or template text (e.g. do not write \"[mock]\", \"TODO\", or \"AWAITING\"); write only real, usable advice.",
  "Keep it to one to three concise, action-oriented sentences.",
].join("\n");

export interface AmbiguityInput {
  question: string;                                        // the decision the rules couldn't resolve
  market?: "India" | "UAE";
  facts?: Record<string, string | number | boolean | null>;
}

/** Build a grounded, provider-agnostic prompt for an ambiguous decision. Retrieval is
 *  broadened to also consider the facts (not just the question) so a terse question still
 *  pulls the right rules, and the answer is explicitly requested in the explainable,
 *  confidence-rated shape the system prompt defines. */
export function buildAmbiguityPrompt(input: AmbiguityInput): AiEnginePrompt {
  // Retrieve KB against the question PLUS the fact values, so grounding fires even when
  // the question itself is short ("what next?") but the facts carry the signal.
  const factText = input.facts
    ? Object.values(input.facts).map((v) => `${v}`).join(" ")
    : "";
  const kb = retrieveKnowledge(`${input.question} ${factText}`, { market: input.market, limit: 3 });
  const grounding = kb.length
    ? "Relevant WCR knowledge (ground your answer in these, do not contradict them):\n" +
      kb.map((k) => `- ${k.entry.topic}: ${k.entry.body}`).join("\n")
    : "";
  const facts = input.facts && Object.keys(input.facts).length
    ? "Facts:\n" + Object.entries(input.facts).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";
  const marketLine = input.market ? `Market: ${input.market} (use its currency only; never convert).` : "";

  const ask =
    "Give the single best next action, then WHY (cite the evidence + a rule above), then end with your confidence (high/medium/low).";

  const user = [input.question, marketLine, facts, grounding, ask].filter(Boolean).join("\n\n");
  return { system: SALES_OS_SYSTEM, user, context: input.facts };
}

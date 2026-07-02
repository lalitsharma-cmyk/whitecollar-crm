// AI Sales OS — prompt templates (M7), PURE + unit-testable. Provider-agnostic: builds
// an AiEnginePrompt (system + user) that ANY provider consumes. Grounded with M6 KB
// retrieval so the LLM cites known WCR rules instead of hallucinating, and carries the
// hard currency/market guardrail in the system prompt.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiEnginePrompt } from "./engine";
import { retrieveKnowledge } from "./knowledge";

export const SALES_OS_SYSTEM = [
  "You are the White Collar Realty Sales OS assistant for a real-estate team operating in India (INR) and Dubai/UAE (AED).",
  "Hard rules you must never break:",
  "- Never mix or convert currency across markets: India deals are INR, UAE deals are AED.",
  "- Only match a buyer to a property in the SAME market.",
  "- Ground every recommendation in the provided knowledge; do not invent project names, prices, or facts.",
  "- You ADVISE only — you never take actions or claim to have done anything.",
  "Answer in one or two concise, specific, action-oriented sentences.",
].join("\n");

export interface AmbiguityInput {
  question: string;                                        // the decision the rules couldn't resolve
  market?: "India" | "UAE";
  facts?: Record<string, string | number | boolean | null>;
}

/** Build a grounded, provider-agnostic prompt for an ambiguous decision. */
export function buildAmbiguityPrompt(input: AmbiguityInput): AiEnginePrompt {
  const kb = retrieveKnowledge(input.question, { market: input.market, limit: 3 });
  const grounding = kb.length
    ? "Relevant WCR knowledge:\n" + kb.map((k) => `- ${k.entry.topic}: ${k.entry.body}`).join("\n")
    : "";
  const facts = input.facts && Object.keys(input.facts).length
    ? "Facts:\n" + Object.entries(input.facts).map(([k, v]) => `- ${k}: ${v}`).join("\n")
    : "";

  const user = [input.question, facts, grounding].filter(Boolean).join("\n\n");
  return { system: SALES_OS_SYSTEM, user, context: input.facts };
}

// AI Sales OS — reason layer (M7). The ONLY place an LLM is invoked, and only for a
// case the deterministic rules couldn't resolve. Deterministic-first by construction:
// the caller passes a `fallbackText` (its best deterministic answer); the LLM only gets
// a chance to improve on it, and ANY failure (no key → mock, network error, empty reply)
// returns the fallback. So the CRM never depends on the LLM being up or configured.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { resolveEngine, type AiEngine } from "./engine";
import { buildAmbiguityPrompt, type AmbiguityInput } from "./prompts";

export interface ReasonOutcome {
  text: string;
  engine: string;    // which engine produced the text ("mock" | "gemini:…" | "fallback")
  usedLlm: boolean;  // true only when a real (non-mock) engine produced the text
}

/** Reason about an ambiguous decision. Never throws; always yields usable text. */
export async function reasonAboutAmbiguity(
  input: AmbiguityInput,
  fallbackText: string,
  engine: AiEngine = resolveEngine(),
): Promise<ReasonOutcome> {
  // The mock engine is NOT a real reasoner — it must never surface its "[mock] …" echo
  // to a user. Return the caller's deterministic answer verbatim (this is the default
  // until a real provider key is configured, so the whole app runs cleanly on mock).
  if (engine.name === "mock") return { text: fallbackText, engine: "mock", usedLlm: false };
  try {
    const res = await engine.complete(buildAmbiguityPrompt(input));
    const text = res.text?.trim();
    if (!text) return { text: fallbackText, engine: res.engine, usedLlm: false };
    return { text, engine: res.engine, usedLlm: true };
  } catch {
    return { text: fallbackText, engine: "fallback", usedLlm: false };
  }
}

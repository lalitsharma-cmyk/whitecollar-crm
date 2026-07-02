// AI Sales OS — provider-independent LLM engine (M0). PURE: no prisma, no
// "server-only" — unit-testable. Only the "reason" layer (L4) ever calls an engine,
// and only for ambiguity the deterministic rules can't resolve. Default engine is
// `mock` (deterministic, free) so nothing calls an external LLM until M7 wires
// Gemini and it's validated. Provider chosen via AI_ENGINE_PROVIDER.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { PROVIDERS, isProvider, resolveKey, resolveModel, type LlmProviderName } from "./providers";
import { HttpLlmEngine } from "./llmEngine";

export interface AiEnginePrompt {
  system?: string;
  user: string;
  /** Optional structured hint the engine may echo back (kept small + auditable). */
  context?: Record<string, string | number | boolean | null>;
}

export interface AiEngineResult {
  text: string;
  engine: string;        // which engine produced it (audit)
  tokensIn?: number;
  tokensOut?: number;
}

export interface AiEngine {
  readonly name: string;
  complete(prompt: AiEnginePrompt): Promise<AiEngineResult>;
}

/** Deterministic, offline, zero-cost engine. It NEVER calls out; it echoes a
 *  structured, explainable summary of the prompt. Default until Gemini is wired.
 *  Because it's deterministic it's safe in tests + safe to run against prod data. */
export const mockEngine: AiEngine = {
  name: "mock",
  async complete(prompt: AiEnginePrompt): Promise<AiEngineResult> {
    const ctx = prompt.context
      ? Object.entries(prompt.context).map(([k, v]) => `${k}=${v}`).join(", ")
      : "";
    const text = `[mock] ${prompt.user.trim()}${ctx ? ` (${ctx})` : ""}`;
    return { text, engine: "mock", tokensIn: prompt.user.length, tokensOut: text.length };
  },
};

/** Any supported engine: the deterministic mock or a config-registered LLM provider.
 *  Providers live in providers.ts (Gemini/OpenAI/Claude/DeepSeek + future) — this type
 *  stays open by deriving from the registry, so adding one needs no change here. */
export type AiProvider = "mock" | LlmProviderName;

/** The configured provider name (AI_ENGINE_PROVIDER), defaulting to Gemini per the
 *  business decision. Unknown values fall back to mock. */
export function configuredProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const raw = (env.AI_ENGINE_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "mock") return "mock";
  if (isProvider(raw)) return raw;
  return raw === "" ? "gemini" : "mock"; // default Gemini; unknown -> safe mock
}

/** Explicit engine selection. "mock" → mock; a provider WITH its key set → a live
 *  HttpLlmEngine; a provider WITHOUT its key → throws (caller asked for it explicitly). */
export function getEngine(provider?: AiProvider): AiEngine {
  const p = provider ?? configuredProvider();
  if (p === "mock") return mockEngine;
  const spec = PROVIDERS[p];
  const key = resolveKey(spec);
  if (!key) throw new Error(`AI provider "${p}" selected but ${spec.keyEnv} is not set.`);
  return new HttpLlmEngine(spec, key);
}

/** PRODUCTION entry — never throws. Returns the configured live engine when its key is
 *  present, else DEGRADES to the deterministic mock so the CRM keeps working (LLM is
 *  only an enrichment for ambiguous cases; deterministic rules remain primary). */
export function resolveEngine(): AiEngine {
  const p = configuredProvider();
  if (p === "mock") return mockEngine;
  const spec = PROVIDERS[p];
  const key = resolveKey(spec);
  return key ? new HttpLlmEngine(spec, key) : mockEngine;
}

/** Diagnostics for an admin status screen — no secrets, just readiness. */
export function engineStatus(): { provider: AiProvider; ready: boolean; model: string | null; reason: string } {
  const p = configuredProvider();
  if (p === "mock") return { provider: "mock", ready: true, model: null, reason: "Deterministic mock engine (no external LLM)." };
  const spec = PROVIDERS[p];
  const key = resolveKey(spec);
  if (!key) return { provider: p, ready: false, model: resolveModel(spec), reason: `${spec.keyEnv} not set — using deterministic mock until a key is configured.` };
  return { provider: p, ready: true, model: resolveModel(spec), reason: "Live engine configured." };
}

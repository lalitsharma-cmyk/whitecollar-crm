// AI Sales OS — provider registry (M7), PURE + unit-testable. The whole point: a new
// LLM provider is added as a DATA spec here (endpoint + request shape + response parse
// + which env holds the key), never as new engine code. Selection is config-driven
// (AI_ENGINE_PROVIDER + AI_<PROVIDER>_MODEL + AI_<PROVIDER>_API_KEY). Gemini 2.5 Flash
// is the default provider; the deterministic mock stays the primary decision-maker and
// the LLM is only invoked for genuine ambiguity (see reason.ts).
//
// buildRequest/parseResponse are PURE (no fetch) so every provider's wire-shape is unit
// tested without a network call or a real key. HttpLlmEngine (llmEngine.ts) does the IO.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiEnginePrompt } from "./engine";

export type LlmProviderName = "gemini" | "openai" | "claude" | "deepseek";

export interface LlmRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ProviderSpec {
  name: LlmProviderName;
  keyEnv: string;        // env var holding the API key
  modelEnv: string;      // env var overriding the model
  defaultModel: string;
  /** Build the HTTP request for this provider. PURE. Key goes in a header, never the URL. */
  buildRequest(prompt: AiEnginePrompt, model: string, apiKey: string): LlmRequest;
  /** Extract the completion text from the provider's JSON response. PURE. */
  parseResponse(json: unknown): string;
}

// ── OpenAI-compatible providers (OpenAI, DeepSeek, most local gateways) share one
//    wire-shape, so they're one factory — adding another is a single line. ──────────
function openAiCompatible(
  name: LlmProviderName,
  keyEnv: string,
  modelEnv: string,
  baseUrl: string,
  defaultModel: string,
): ProviderSpec {
  return {
    name, keyEnv, modelEnv, defaultModel,
    buildRequest(prompt, model, apiKey) {
      const messages: Array<{ role: string; content: string }> = [];
      if (prompt.system) messages.push({ role: "system", content: prompt.system });
      messages.push({ role: "user", content: prompt.user });
      return {
        url: `${baseUrl}/chat/completions`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.2 }),
      };
    },
    parseResponse(json) {
      const j = json as { choices?: Array<{ message?: { content?: string } }> };
      return j.choices?.[0]?.message?.content ?? "";
    },
  };
}

// ── Gemini (Google Generative Language API) — key via x-goog-api-key header (NOT the
//    URL, so the secret never lands in a query string / log). ─────────────────────────
const gemini: ProviderSpec = {
  name: "gemini",
  keyEnv: "AI_GEMINI_API_KEY",
  modelEnv: "AI_GEMINI_MODEL",
  defaultModel: "gemini-2.5-flash",
  buildRequest(prompt, model, apiKey) {
    const body: Record<string, unknown> = { contents: [{ role: "user", parts: [{ text: prompt.user }] }] };
    if (prompt.system) body.systemInstruction = { parts: [{ text: prompt.system }] };
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    };
  },
  parseResponse(json) {
    const j = json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  },
};

// ── Claude (Anthropic Messages API). ────────────────────────────────────────────────
const claude: ProviderSpec = {
  name: "claude",
  keyEnv: "AI_CLAUDE_API_KEY",
  modelEnv: "AI_CLAUDE_MODEL",
  defaultModel: "claude-haiku-4-5-20251001",
  buildRequest(prompt, model, apiKey) {
    const body: Record<string, unknown> = {
      model, max_tokens: 1024,
      messages: [{ role: "user", content: prompt.user }],
    };
    if (prompt.system) body.system = prompt.system;
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    };
  },
  parseResponse(json) {
    const j = json as { content?: Array<{ text?: string }> };
    return j.content?.map((c) => c.text ?? "").join("") ?? "";
  },
};

/** The registry. Add a provider = add an entry (config), not engine code. */
export const PROVIDERS: Record<LlmProviderName, ProviderSpec> = {
  gemini,
  claude,
  openai: openAiCompatible("openai", "AI_OPENAI_API_KEY", "AI_OPENAI_MODEL", "https://api.openai.com/v1", "gpt-4o-mini"),
  deepseek: openAiCompatible("deepseek", "AI_DEEPSEEK_API_KEY", "AI_DEEPSEEK_MODEL", "https://api.deepseek.com", "deepseek-chat"),
};

export const isProvider = (p: string): p is LlmProviderName => p in PROVIDERS;

/** Model for a spec: env override else the provider default. */
export function resolveModel(spec: ProviderSpec, env: NodeJS.ProcessEnv = process.env): string {
  return env[spec.modelEnv]?.trim() || spec.defaultModel;
}

/** The API key for a spec, or null if unset. */
export function resolveKey(spec: ProviderSpec, env: NodeJS.ProcessEnv = process.env): string | null {
  const k = env[spec.keyEnv]?.trim();
  return k ? k : null;
}

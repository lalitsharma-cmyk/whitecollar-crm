import "server-only";
import type { AIProvider, AIRequest, AIResponse, AIProviderName } from "./types";

/**
 * Provider registry. The ONE swap point for Phase 2.
 *
 * Default = mock (no key, no cost, deterministic). When a provider is chosen,
 * set AI_ENGINE_PROVIDER=claude|gpt|gemini in Vercel — every engine, route and
 * UI keeps working untouched. Real adapters are already implemented below so
 * "plug in later" is literally one env var, not a code change.
 *
 * NOTE: deliberately independent of the existing ANTHROPIC/OPENAI/GEMINI keys
 * used by the Lalit-only War Room. The engine layer reads the SAME keys but is
 * gated separately so turning engines on never disturbs the pilot.
 */

function now(): number {
  return Date.now();
}

// ─── Mock provider ──────────────────────────────────────────────────────────────

class MockProvider implements AIProvider {
  readonly name = "mock" as const;
  readonly model = "mock-deterministic";
  isConfigured(): boolean {
    return true;
  }
  async complete(_req: AIRequest): Promise<AIResponse> {
    // The engine's own .mock() is used upstream; this only exists so the
    // provider contract is total. It never produces engine output directly.
    return {
      text: "{}",
      provider: "mock",
      model: this.model,
      inputTokens: 0,
      outputTokens: 0,
      ms: 0,
      ok: true,
    };
  }
}

// ─── Claude adapter ─────────────────────────────────────────────────────────────

class ClaudeProvider implements AIProvider {
  readonly name = "claude" as const;
  readonly model = process.env.AI_ENGINE_CLAUDE_MODEL ?? "claude-sonnet-4-6";
  isConfigured(): boolean {
    return !!process.env.ANTHROPIC_API_KEY?.trim();
  }
  async complete(req: AIRequest): Promise<AIResponse> {
    const t0 = now();
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });
      const msg = await client.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 4000,
        temperature: req.temperature ?? 0.3,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        text,
        provider: this.name,
        model: this.model,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
        ms: now() - t0,
        ok: true,
      };
    } catch (e) {
      return errorResponse(this.name, this.model, now() - t0, e);
    }
  }
}

// ─── GPT adapter ────────────────────────────────────────────────────────────────

class GptProvider implements AIProvider {
  readonly name = "gpt" as const;
  readonly model = process.env.AI_ENGINE_GPT_MODEL ?? "gpt-4.1-mini";
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY?.trim();
  }
  async complete(req: AIRequest): Promise<AIResponse> {
    const t0 = now();
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: req.temperature ?? 0.3,
          max_tokens: req.maxTokens ?? 4000,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        return { text: "", provider: this.name, model: this.model, inputTokens: 0, outputTokens: 0, ms: now() - t0, ok: false, error: `HTTP ${res.status}: ${body.error?.message ?? "unknown"}` };
      }
      return {
        text: body.choices?.[0]?.message?.content ?? "",
        provider: this.name,
        model: this.model,
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        ms: now() - t0,
        ok: true,
      };
    } catch (e) {
      return errorResponse(this.name, this.model, now() - t0, e);
    }
  }
}

// ─── Gemini adapter ─────────────────────────────────────────────────────────────

class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  readonly model = process.env.AI_ENGINE_GEMINI_MODEL ?? "gemini-2.5-flash";
  isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY?.trim();
  }
  async complete(req: AIRequest): Promise<AIResponse> {
    const t0 = now();
    try {
      const key = process.env.GEMINI_API_KEY!.trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: req.temperature ?? 0.3,
            maxOutputTokens: req.maxTokens ?? 4000,
            ...(req.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      const body = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        return { text: "", provider: this.name, model: this.model, inputTokens: 0, outputTokens: 0, ms: now() - t0, ok: false, error: `HTTP ${res.status}: ${body.error?.message ?? "unknown"}` };
      }
      return {
        text: body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "",
        provider: this.name,
        model: this.model,
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        ms: now() - t0,
        ok: true,
      };
    } catch (e) {
      return errorResponse(this.name, this.model, now() - t0, e);
    }
  }
}

function errorResponse(provider: AIProviderName, model: string, ms: number, e: unknown): AIResponse {
  return {
    text: "",
    provider,
    model,
    inputTokens: 0,
    outputTokens: 0,
    ms,
    ok: false,
    error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
  };
}

// ─── Registry ───────────────────────────────────────────────────────────────────

const MOCK = new MockProvider();
const PROVIDERS: Record<Exclude<AIProviderName, "mock">, AIProvider> = {
  claude: new ClaudeProvider(),
  gpt: new GptProvider(),
  gemini: new GeminiProvider(),
};

/** Which provider the engine layer should use. Defaults to mock until selected. */
export function activeProviderName(): AIProviderName {
  const v = (process.env.AI_ENGINE_PROVIDER ?? "mock").toLowerCase();
  return (["mock", "claude", "gpt", "gemini"] as const).includes(v as AIProviderName)
    ? (v as AIProviderName)
    : "mock";
}

/**
 * Resolve a provider. Falls back to mock when the requested provider has no key,
 * so the system NEVER hard-fails on a missing credential — it degrades to mock.
 */
export function getProvider(name?: AIProviderName): AIProvider {
  const want = name ?? activeProviderName();
  if (want === "mock") return MOCK;
  const p = PROVIDERS[want];
  return p.isConfigured() ? p : MOCK;
}

export function providerStatus(): { active: AIProviderName; configured: Record<string, boolean> } {
  return {
    active: activeProviderName(),
    configured: {
      claude: PROVIDERS.claude.isConfigured(),
      gpt: PROVIDERS.gpt.isConfigured(),
      gemini: PROVIDERS.gemini.isConfigured(),
    },
  };
}

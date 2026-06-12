import "server-only";
import type { Engine, EngineContext, EngineRunResult, AIProviderName } from "./types";
import { getProvider } from "./providers";

/**
 * Run any engine through the active provider.
 *
 * Behaviour:
 *  - provider === mock (default)           → engine.mock(), zero cost
 *  - provider configured + call OK + parses → real typed output
 *  - provider call fails OR parse fails     → graceful fallback to engine.mock()
 *
 * So the entire engine fleet is fully functional TODAY on mock data, and the
 * day a provider key + AI_ENGINE_PROVIDER are set, the same call returns real
 * output with no code change anywhere.
 */
export async function runEngine<TOut>(
  engine: Engine<TOut>,
  ctx: EngineContext,
  opts?: { provider?: AIProviderName },
): Promise<EngineRunResult<TOut>> {
  const provider = getProvider(opts?.provider);

  // Mock path — no network, deterministic, lead-aware.
  if (provider.name === "mock") {
    return {
      ok: true,
      output: engine.mock(ctx),
      mocked: true,
      provider: "mock",
      model: "mock-deterministic",
      inputTokens: 0,
      outputTokens: 0,
      ms: 0,
    };
  }

  const { system, user } = engine.buildPrompt(ctx);
  const res = await provider.complete({ system, user, json: true, maxTokens: 4000, temperature: 0.3 });

  if (!res.ok) {
    return {
      ok: false,
      output: engine.mock(ctx),
      mocked: true,
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      ms: res.ms,
      error: res.error,
    };
  }

  try {
    const output = engine.parse(res.text);
    return {
      ok: true,
      output,
      mocked: false,
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      ms: res.ms,
    };
  } catch (e) {
    return {
      ok: false,
      output: engine.mock(ctx),
      mocked: true,
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
      ms: res.ms,
      error: `parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Strip ```json fences a provider may wrap around JSON, then JSON.parse. */
export function parseJsonLoose<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

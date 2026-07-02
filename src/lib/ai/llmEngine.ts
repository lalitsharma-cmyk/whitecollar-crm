// AI Sales OS — HTTP LLM engine (M7). The ONE piece that does network IO; it's generic
// over any ProviderSpec, so no provider needs its own engine class. Uses global fetch
// (Next runtime / Node 18+). Never called in tests (the wire-shapes are unit-tested pure
// in providers.test.ts); reached only for genuine ambiguity, and only when a key is set.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiEngine, AiEngineResult, AiEnginePrompt } from "./engine";
import { type ProviderSpec, resolveModel } from "./providers";

const TIMEOUT_MS = 20_000;

export class HttpLlmEngine implements AiEngine {
  constructor(private readonly spec: ProviderSpec, private readonly apiKey: string) {}

  get name(): string {
    return this.spec.name;
  }

  async complete(prompt: AiEnginePrompt): Promise<AiEngineResult> {
    const model = resolveModel(this.spec);
    const req = this.spec.buildRequest(prompt, model, this.apiKey);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal: ctrl.signal });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`${this.spec.name} LLM HTTP ${res.status}: ${detail}`);
      }
      const json = await res.json();
      const text = this.spec.parseResponse(json).trim();
      return { text, engine: `${this.spec.name}:${model}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

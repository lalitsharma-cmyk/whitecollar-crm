/**
 * Phase-2 AI engine architecture — PROVIDER-INDEPENDENT CORE.
 *
 * Nothing here knows about Claude / GPT / Gemini. Engines build prompts and
 * declare a typed output + a deterministic mock. A provider (mock by default)
 * is injected at runtime. Selecting a real provider later is a one-line change
 * in providers.ts — no engine, schema, API route, or UI needs to be rewritten.
 *
 * This is SEPARATE from the existing Lalit-only War Room intelligence
 * (ai-claude.ts / ai-gpt-intelligence.ts / ai-gemini-intelligence.ts), which
 * stays exactly as-is.
 */

// ─── Provider layer ─────────────────────────────────────────────────────────────

export type AIProviderName = "mock" | "claude" | "gpt" | "gemini";

export interface AIRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for strict JSON output when supported. */
  json?: boolean;
}

export interface AIResponse {
  text: string;
  provider: AIProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface AIProvider {
  readonly name: AIProviderName;
  readonly model: string;
  /** True when the underlying API key is present in the environment. */
  isConfigured(): boolean;
  complete(req: AIRequest): Promise<AIResponse>;
}

// ─── Engine layer ───────────────────────────────────────────────────────────────

/**
 * Normalized, provider-agnostic snapshot of a lead. Engines read ONLY this —
 * never the raw Prisma row — so a single builder controls what the AI sees and
 * the "AI must never overwrite CRM data" rule is enforced at the boundary.
 */
export interface EngineLeadInput {
  id: string;
  name: string;
  status?: string | null;
  budget?: string | null;
  source?: string | null;
  team?: string | null;
  requirement?: string | null;
  /** Free-text remarks / conversation history, newest first, already merged. */
  remarks?: string | null;
  bant?: {
    budget?: string | null;
    authority?: string | null;
    need?: string | null;
    timeline?: string | null;
  } | null;
  /** Human-readable activity lines, newest first. */
  recentActivities?: string[];
  lastContactDays?: number | null;
  meetingsCount?: number;
  siteVisitsCount?: number;
  ownerName?: string | null;
}

export interface EngineContext {
  lead: EngineLeadInput;
  /** Optional persisted AI memory for this lead (prior runs, decisions). */
  memory?: Record<string, unknown> | null;
}

/**
 * An engine is a self-contained capability: prompt + typed output + a
 * deterministic mock that lets the whole feature ship and render before any
 * provider is selected.
 */
export interface Engine<TOut> {
  key: string;
  title: string;
  description: string;
  /** Build the system + user prompt for a real provider call. */
  buildPrompt(ctx: EngineContext): { system: string; user: string };
  /** Deterministic, lead-aware stand-in used when provider === mock or on failure. */
  mock(ctx: EngineContext): TOut;
  /** Parse a real provider's raw text into the typed output (throws on bad shape). */
  parse(raw: string): TOut;
}

export interface EngineRunResult<TOut> {
  ok: boolean;
  output: TOut;
  /** True when the output came from the mock (no provider configured, or fallback). */
  mocked: boolean;
  provider: AIProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  error?: string;
}

// AI Sales OS — M7 provider-registry + engine-resolution + reason local validation.
// PURE: no network calls (wire-shapes tested against sample JSON). tsx.
import { PROVIDERS, resolveModel, resolveKey, isProvider, type ProviderSpec } from "./providers";
import { configuredProvider, getEngine, resolveEngine, engineStatus, mockEngine, type AiEngine, type AiEngineResult } from "./engine";
import { buildAmbiguityPrompt, SALES_OS_SYSTEM } from "./prompts";
import { reasonAboutAmbiguity } from "./reason";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };
const clearEnv = () => { for (const k of Object.keys(process.env)) if (k.startsWith("AI_")) delete process.env[k]; };
const prompt = { system: "sys", user: "hello", context: {} };

// ── Registry + wire-shapes (pure, no network) ──────────────────────────────
ok("registry has gemini/openai/claude/deepseek", ["gemini", "openai", "claude", "deepseek"].every((p) => isProvider(p)));
ok("gemini is the default model 2.5-flash", PROVIDERS.gemini.defaultModel === "gemini-2.5-flash");

const g = PROVIDERS.gemini.buildRequest(prompt, "gemini-2.5-flash", "SECRET");
ok("gemini key goes in header, NOT the url", !g.url.includes("SECRET") && g.headers["x-goog-api-key"] === "SECRET");
ok("gemini url targets the model endpoint", g.url.includes("/models/gemini-2.5-flash:generateContent"));
ok("gemini parses candidates→text", PROVIDERS.gemini.parseResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }) === "hi");

const o = PROVIDERS.openai.buildRequest(prompt, "gpt-4o-mini", "KEY");
ok("openai uses Bearer auth", o.headers.Authorization === "Bearer KEY");
ok("openai parses choices→message.content", PROVIDERS.openai.parseResponse({ choices: [{ message: { content: "yo" } }] }) === "yo");
ok("deepseek is openai-compatible (choices shape)", PROVIDERS.deepseek.parseResponse({ choices: [{ message: { content: "ds" } }] }) === "ds");

const c = PROVIDERS.claude.buildRequest(prompt, "claude-haiku-4-5-20251001", "AKEY");
ok("claude uses x-api-key + version header", c.headers["x-api-key"] === "AKEY" && !!c.headers["anthropic-version"]);
ok("claude parses content[]→text", PROVIDERS.claude.parseResponse({ content: [{ text: "cl" }] }) === "cl");
ok("malformed response → empty string (no throw)", PROVIDERS.gemini.parseResponse({}) === "");

// ── Config-driven model/key overrides ──────────────────────────────────────
clearEnv();
ok("model falls back to default", resolveModel(PROVIDERS.gemini) === "gemini-2.5-flash");
process.env.AI_GEMINI_MODEL = "gemini-2.5-pro";
ok("model honors env override", resolveModel(PROVIDERS.gemini) === "gemini-2.5-pro");
ok("key is null when unset", resolveKey(PROVIDERS.openai) === null);

// ── Provider resolution + graceful degrade ─────────────────────────────────
clearEnv();
ok("default provider is gemini (business decision)", configuredProvider() === "gemini");
process.env.AI_ENGINE_PROVIDER = "mock";
ok("explicit mock respected", configuredProvider() === "mock");
process.env.AI_ENGINE_PROVIDER = "nonsense";
ok("unknown provider → safe mock", configuredProvider() === "mock");

clearEnv();
process.env.AI_ENGINE_PROVIDER = "gemini"; // no key set
ok("resolveEngine degrades to mock when no key", resolveEngine().name === "mock");
ok("engineStatus reports not-ready + reason when no key", (() => { const s = engineStatus(); return s.provider === "gemini" && s.ready === false && /AI_GEMINI_API_KEY/.test(s.reason); })());
let threw = false; try { getEngine("gemini"); } catch { threw = true; }
ok("getEngine THROWS on explicit provider w/o key", threw);

process.env.AI_GEMINI_API_KEY = "test-key";
ok("resolveEngine returns live engine when key present", resolveEngine().name === "gemini");
ok("engineStatus ready when key present", engineStatus().ready === true);
clearEnv();

// ── Prompt grounding ───────────────────────────────────────────────────────
const p = buildAmbiguityPrompt({ question: "Can I match an India buyer to an AED Dubai property?", market: "UAE", facts: { budget: "2M AED" } });
ok("prompt carries the currency/market system guardrail", p.system === SALES_OS_SYSTEM && /never mix or convert currency/i.test(p.system!));
ok("prompt grounds with retrieved KB", /Relevant WCR knowledge/.test(p.user) && /market/i.test(p.user));
ok("prompt includes the facts", /budget: 2M AED/.test(p.user));

// ── Reason layer: deterministic-first + always-falls-back ───────────────────
(async () => {
  const viaMock = await reasonAboutAmbiguity({ question: "next step?" }, "FALLBACK", mockEngine);
  ok("mock engine returns the deterministic fallback (no [mock] leak), usedLlm=false", viaMock.text === "FALLBACK" && viaMock.usedLlm === false);

  const boom: AiEngine = { name: "gemini", async complete(): Promise<AiEngineResult> { throw new Error("network down"); } };
  const viaErr = await reasonAboutAmbiguity({ question: "next step?" }, "FALLBACK", boom);
  ok("engine error → deterministic fallback", viaErr.text === "FALLBACK" && viaErr.engine === "fallback" && viaErr.usedLlm === false);

  const empty: AiEngine = { name: "gemini", async complete(): Promise<AiEngineResult> { return { text: "  ", engine: "gemini:x" }; } };
  const viaEmpty = await reasonAboutAmbiguity({ question: "next step?" }, "FALLBACK", empty);
  ok("empty LLM reply → fallback", viaEmpty.text === "FALLBACK");

  const live: AiEngine = { name: "gemini", async complete(): Promise<AiEngineResult> { return { text: "Call the buyer today.", engine: "gemini:2.5" }; } };
  const viaLive = await reasonAboutAmbiguity({ question: "next step?" }, "FALLBACK", live);
  ok("live engine text used, usedLlm=true", viaLive.text === "Call the buyer today." && viaLive.usedLlm === true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();

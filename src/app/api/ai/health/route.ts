import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiProvider } from "@/lib/ai";

/**
 * GET /api/ai/health
 *
 * Admin-only diagnostic. Runs a real round-trip test against the configured
 * provider and surfaces SPECIFIC failure reasons inline (HTTP status, response
 * body snippet) so we don't have to hunt through Vercel function logs to
 * diagnose "AI not updating".
 *
 * Direct fetch rather than going through lib/ai.generateText so we have full
 * visibility into the underlying HTTP exchange.
 */
export async function GET(req: Request) {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const provider = aiProvider();
  if (!provider) {
    return NextResponse.json({
      ok: false,
      provider: null,
      reason: "No AI key configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in Vercel env vars and redeploy.",
      hint: "Vercel Project → Settings → Environment Variables → add GEMINI_API_KEY with value from https://aistudio.google.com → Save → redeploy.",
    });
  }

  // ?list=1 → which models does THIS key support for generateContent? Used to
  // pick a currently-available model when a default goes stale (Google retires
  // model ids over time, e.g. gemini-1.5-flash → 404).
  if (new URL(req.url).searchParams.get("list") === "1" && provider === "gemini") {
    return listGeminiModels();
  }

  if (provider === "gemini") return testGemini();
  if (provider === "anthropic") return testAnthropic();
  return NextResponse.json({ ok: false, provider, reason: "Unknown provider" });
}

async function listGeminiModels() {
  const key = process.env.GEMINI_API_KEY!;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=200`);
    const j = await r.json();
    const all: { name?: string; supportedGenerationMethods?: string[] }[] = j.models ?? [];
    const generateContentModels = all
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => (m.name ?? "").replace("models/", ""))
      .filter((n) => n.startsWith("gemini"));
    return NextResponse.json({ ok: r.ok, count: generateContentModels.length, generateContentModels });
  } catch (e) {
    return NextResponse.json({ ok: false, reason: `ListModels failed: ${String(e).slice(0, 200)}` });
  }
}

async function testGemini() {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const t0 = Date.now();
  let httpStatus: number | null = null;
  let bodySnippet = "";
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Reply with exactly the word 'ok' and nothing else." }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0 },
      }),
    });
    httpStatus = r.status;
    const ms = Date.now() - t0;
    const text = await r.text();
    bodySnippet = text.slice(0, 600);
    if (!r.ok) {
      // Surface the actual Google error so admin sees WHY (invalid key, model
      // not found, billing required, quota exceeded, etc.)
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      const errMessage = (parsed && typeof parsed === "object" && "error" in parsed
        ? (parsed as { error?: { message?: string; status?: string } }).error
        : null) ?? null;
      return NextResponse.json({
        ok: false,
        provider: "gemini",
        model,
        httpStatus,
        latencyMs: ms,
        reason: errMessage ? `${errMessage.status ?? "ERROR"}: ${errMessage.message ?? "(no message)"}` : `HTTP ${httpStatus}`,
        rawBodySnippet: bodySnippet,
        hint: httpStatus === 400 ? "Common cause: model name wrong. Set GEMINI_MODEL env var to a valid model (gemini-2.0-flash, gemini-1.5-flash, gemini-1.5-pro)." :
              httpStatus === 401 || httpStatus === 403 ? "Key is invalid, revoked, or not enabled for the Generative Language API. Generate a fresh key at https://aistudio.google.com and replace GEMINI_API_KEY in Vercel." :
              httpStatus === 429 ? "Quota exceeded. Free tier is 15 req/min, 1500 req/day. Wait a minute or check https://console.cloud.google.com/apis/dashboard." :
              "Check the rawBodySnippet for details.",
      });
    }
    const j = JSON.parse(text);
    const respText = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return NextResponse.json({
      ok: true,
      provider: "gemini",
      model,
      httpStatus,
      latencyMs: ms,
      testResponse: respText.trim().slice(0, 200),
      summary: `✓ Gemini ${model} is live (${ms}ms round-trip). Logging a new call on any lead will refresh that lead's AI Summary + Next Action. The 🔄 Regenerate button on the Client Summary card also works now.`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      provider: "gemini",
      model,
      httpStatus,
      latencyMs: Date.now() - t0,
      reason: `Network error: ${String(e).slice(0, 200)}`,
      rawBodySnippet: bodySnippet,
    });
  }
}

async function testAnthropic() {
  const t0 = Date.now();
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const model = process.env.AI_MODEL ?? "claude-haiku-4-5";
    const msg = await client.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with exactly the word 'ok' and nothing else." }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return NextResponse.json({
      ok: true,
      provider: "anthropic",
      model,
      latencyMs: Date.now() - t0,
      testResponse: text.trim().slice(0, 200),
      summary: `✓ Claude ${model} is live (${Date.now() - t0}ms round-trip).`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      provider: "anthropic",
      latencyMs: Date.now() - t0,
      reason: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
    });
  }
}

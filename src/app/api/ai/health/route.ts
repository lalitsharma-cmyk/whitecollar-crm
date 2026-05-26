import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { aiProvider, generateText } from "@/lib/ai";

/**
 * GET /api/ai/health
 *
 * Admin-only diagnostic. Returns which AI provider is configured + a real
 * round-trip test response. Used to verify GEMINI_API_KEY / ANTHROPIC_API_KEY
 * are loaded correctly in Vercel after a deploy.
 *
 * Lalit reported "Ai also does not update" — without this, every failure mode
 * (missing key, wrong key, network error, quota exceeded) shows up identically
 * as "summary stays stale". This endpoint surfaces the specific reason.
 */
export async function GET() {
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

  const t0 = Date.now();
  const testPrompt = "Reply with exactly the word 'ok' and nothing else.";
  const text = await generateText({ prompt: testPrompt, maxTokens: 10 });
  const ms = Date.now() - t0;

  if (text == null) {
    return NextResponse.json({
      ok: false,
      provider,
      reason: `${provider} request returned null (likely an HTTP error). Check Vercel function logs for the underlying response.`,
      hint: "Most common: API key invalid / revoked / has zero quota left. Generate a fresh key and update Vercel env var.",
      latencyMs: ms,
    });
  }

  return NextResponse.json({
    ok: true,
    provider,
    testPrompt,
    testResponse: text.trim().slice(0, 200),
    latencyMs: ms,
    summary: `✓ ${provider} is live (${ms}ms round-trip). Logging a new call on any lead will refresh that lead's AI Summary + Next Action.`,
  });
}

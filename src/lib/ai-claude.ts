import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildLeadPrompt, isAiPilotLead, type LeadForAnalysis } from "@/lib/ai-openai";
import { INTELLIGENCE_SYSTEM_PROMPT, type IntelligenceResult } from "@/lib/ai-intelligence-schema";

const MODEL = "claude-sonnet-4-6";
const LALIT_ID = "cmplo0t6v0000vpxslasvbwuq";
const COST_INPUT_PER_M  = 3.00;
const COST_OUTPUT_PER_M = 15.00;

export function claudeEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export { isAiPilotLead, LALIT_ID };

export async function analyzeLeadWithClaude(
  lead: LeadForAnalysis,
  triggeredById: string,
  triggeredBy: "manual" | "re-analyze" = "manual"
): Promise<{ analysisId: string; result: IntelligenceResult }> {
  if (!claudeEnabled()) throw new Error("ANTHROPIC_API_KEY not configured");
  if (!isAiPilotLead(lead.ownerId as string | undefined)) {
    throw new Error("Claude Intelligence pilot is only available for Lalit Sharma's leads");
  }

  const userPrompt = buildLeadPrompt(lead);
  const startMs = Date.now();

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim() });

  let msg: Awaited<ReturnType<typeof client.messages.create>>;
  try {
    msg = await client.messages.create({
      model: MODEL,
      // The 18-section intelligence JSON runs ~7.5k tokens; 8000 truncated it
      // mid-object → "invalid JSON". 16000 gives ample headroom.
      max_tokens: 16000,
      temperature: 0.3,
      system: INTELLIGENCE_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userPrompt },
        // Prefill the reply with "{" so Claude emits JSON immediately — no
        // preamble, no ```json fences. We prepend the "{" back when parsing.
        { role: "assistant", content: "{" },
      ],
    });
  } catch (e) {
    const ms = Date.now() - startMs;
    await prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: MODEL, feature: "claude_intelligence", leadId: lead.id, ms, ok: false },
    }).catch(() => {});
    throw new Error(`Anthropic API error: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ms = Date.now() - startMs;
  // Prepend the "{" we prefilled the assistant turn with.
  const rawText = "{" + msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  const inputTokens = msg.usage?.input_tokens ?? 0;
  const outputTokens = msg.usage?.output_tokens ?? 0;
  const costMicroUsd = Math.round(
    (inputTokens / 1_000_000) * COST_INPUT_PER_M * 1_000_000 +
    (outputTokens / 1_000_000) * COST_OUTPUT_PER_M * 1_000_000
  );

  const result = parseIntelligenceLoose(rawText);
  if (!result) {
    await prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: MODEL, feature: "claude_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
    }).catch(() => {});
    const truncated = msg.stop_reason === "max_tokens";
    const tail = rawText.slice(-200).replace(/\n/g, " ");
    throw new Error(
      truncated
        ? `Claude hit the token limit and the JSON was incomplete even after repair. Tail: …${tail}`
        : `Claude returned invalid JSON. Tail: …${tail}`,
    );
  }

  const [analysis] = await prisma.$transaction([
    prisma.aiAnalysis.create({
      data: {
        leadId: lead.id,
        triggeredBy,
        triggeredById,
        resultJson: JSON.stringify(result),
        model: MODEL,
        inputTokens,
        outputTokens,
        costMicroUsd,
        ok: true,
      },
    }),
    prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: MODEL, feature: "claude_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: true },
    }),
  ]);

  return { analysisId: analysis.id, result };
}

export async function getLatestClaudeAnalysis(leadId: string) {
  return prisma.aiAnalysis.findFirst({
    where: { leadId, model: MODEL },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Parse Claude's JSON tolerantly. If a long response is truncated at the token
 * limit, repair it (close open brackets / a dangling string) and keep the
 * sections that DID complete — the War Room renders "NOT ENOUGH DATA" for any
 * section the repair had to drop, which beats failing the whole analysis.
 */
function parseIntelligenceLoose(raw: string): IntelligenceResult | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try { return JSON.parse(cleaned) as IntelligenceResult; } catch { /* fall through to repair */ }
  const repaired = repairTruncatedJson(cleaned);
  if (repaired) {
    try { return JSON.parse(repaired) as IntelligenceResult; } catch { /* unrepairable */ }
  }
  return null;
}

/**
 * Best-effort repair for JSON truncated mid-stream. Scans backward from the end
 * for a structural boundary, closes the open brackets/string for that prefix,
 * and returns the first candidate that actually parses. Bounded so a one-off
 * repair stays cheap.
 */
function repairTruncatedJson(s: string): string | null {
  const floor = Math.max(0, s.length - 4000); // don't scan back further than the last ~section
  for (let end = s.length; end > floor; end--) {
    const c = s[end - 1];
    if (c !== "}" && c !== "]" && c !== '"' && !/[0-9eltursfn]/.test(c)) continue;
    const candidate = closeOpenBrackets(s.slice(0, end));
    if (candidate) {
      try { JSON.parse(candidate); return candidate; } catch { /* try an earlier boundary */ }
    }
  }
  return null;
}

/** Append the closers needed to balance a (possibly mid-string) JSON prefix. */
function closeOpenBrackets(prefix: string): string | null {
  let inStr = false, esc = false;
  const close: string[] = [];
  for (let i = 0; i < prefix.length; i++) {
    const c = prefix[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") close.push("}");
    else if (c === "[") close.push("]");
    else if (c === "}" || c === "]") close.pop();
  }
  if (close.length === 0 && !inStr) return null;
  let out = prefix.replace(/[\s,]+$/, "");
  if (inStr) out += '"';
  for (let i = close.length - 1; i >= 0; i--) out += close[i];
  return out;
}

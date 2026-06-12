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
      max_tokens: 8000,
      temperature: 0.3,
      system: INTELLIGENCE_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userPrompt },
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
  const rawText = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");

  const inputTokens = msg.usage?.input_tokens ?? 0;
  const outputTokens = msg.usage?.output_tokens ?? 0;
  const costMicroUsd = Math.round(
    (inputTokens / 1_000_000) * COST_INPUT_PER_M * 1_000_000 +
    (outputTokens / 1_000_000) * COST_OUTPUT_PER_M * 1_000_000
  );

  let result: IntelligenceResult;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    result = JSON.parse(cleaned) as IntelligenceResult;
  } catch {
    await prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: MODEL, feature: "claude_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
    }).catch(() => {});
    const preview = rawText.slice(0, 200).replace(/\n/g, " ");
    throw new Error(`Claude returned invalid JSON. Preview: ${preview}`);
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

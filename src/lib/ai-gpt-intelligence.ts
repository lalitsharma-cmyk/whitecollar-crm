import "server-only";
import { prisma } from "@/lib/prisma";
import { buildLeadPrompt, isAiPilotLead, type LeadForAnalysis } from "@/lib/ai-openai";
import { INTELLIGENCE_SYSTEM_PROMPT, type IntelligenceResult } from "@/lib/ai-intelligence-schema";

// GPT-4.1 Mini — Intelligence Layer
// This is SEPARATE from the existing GPT extraction (ai-openai.ts).
// The extraction layer extracts CRM fields. This layer generates sales intelligence.
const MODEL = "gpt-4.1-mini";
const INTELLIGENCE_MODEL_KEY = "gpt-4.1-mini-intelligence";
const COST_INPUT_PER_M  = 0.40;
const COST_OUTPUT_PER_M = 1.60;

export function gptIntelligenceEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

export { isAiPilotLead };

export async function analyzeLeadWithGpt(
  lead: LeadForAnalysis,
  triggeredById: string,
  triggeredBy: "manual" | "re-analyze" = "manual"
): Promise<{ analysisId: string; result: IntelligenceResult }> {
  if (!gptIntelligenceEnabled()) throw new Error("OPENAI_API_KEY not configured");
  if (!isAiPilotLead(lead.ownerId as string | undefined)) {
    throw new Error("GPT Intelligence pilot is only available for Lalit Sharma's leads");
  }

  const userPrompt = buildLeadPrompt(lead);
  const startMs = Date.now();

  let httpStatus: number | null = null;
  let rawText = "";

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTELLIGENCE_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    httpStatus = res.status;
    const body = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${httpStatus} ${body.error?.message ?? "unknown"}`);
    }

    rawText = body.choices?.[0]?.message?.content ?? "";
    const ms = Date.now() - startMs;
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    const costMicroUsd = Math.round(
      (inputTokens / 1_000_000) * COST_INPUT_PER_M * 1_000_000 +
      (outputTokens / 1_000_000) * COST_OUTPUT_PER_M * 1_000_000
    );

    let result: IntelligenceResult;
    try {
      result = JSON.parse(rawText) as IntelligenceResult;
    } catch {
      await prisma.aiUsageLog.create({
        data: { provider: "openai", model: INTELLIGENCE_MODEL_KEY, feature: "gpt_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
      }).catch(() => {});
      throw new Error(`GPT returned invalid JSON. Preview: ${rawText.slice(0, 200)}`);
    }

    const [analysis] = await prisma.$transaction([
      prisma.aiAnalysis.create({
        data: {
          leadId: lead.id,
          triggeredBy,
          triggeredById,
          resultJson: JSON.stringify(result),
          model: INTELLIGENCE_MODEL_KEY,
          inputTokens,
          outputTokens,
          costMicroUsd,
          ok: true,
        },
      }),
      prisma.aiUsageLog.create({
        data: { provider: "openai", model: INTELLIGENCE_MODEL_KEY, feature: "gpt_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: true },
      }),
    ]);

    return { analysisId: analysis.id, result };
  } catch (e) {
    const ms = Date.now() - startMs;
    await prisma.aiUsageLog.create({
      data: { provider: "openai", model: INTELLIGENCE_MODEL_KEY, feature: "gpt_intelligence", leadId: lead.id, ms, ok: false },
    }).catch(() => {});
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function getLatestGptIntelligence(leadId: string) {
  return prisma.aiAnalysis.findFirst({
    where: { leadId, model: INTELLIGENCE_MODEL_KEY },
    orderBy: { createdAt: "desc" },
  });
}

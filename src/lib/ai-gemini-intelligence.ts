import "server-only";
import { prisma } from "@/lib/prisma";
import { buildLeadPrompt, isAiPilotLead, type LeadForAnalysis } from "@/lib/ai-openai";
import { INTELLIGENCE_SYSTEM_PROMPT, type IntelligenceResult } from "@/lib/ai-intelligence-schema";

const MODEL_ID = "gemini-2.5-flash";
const MODEL_KEY = "gemini-2.5-flash-intelligence";
const COST_INPUT_PER_M  = 0.15;
const COST_OUTPUT_PER_M = 0.60;

export function geminiIntelligenceEnabled(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

export { isAiPilotLead };

export async function analyzeLeadWithGemini(
  lead: LeadForAnalysis,
  triggeredById: string,
  triggeredBy: "manual" | "re-analyze" = "manual"
): Promise<{ analysisId: string; result: IntelligenceResult }> {
  if (!geminiIntelligenceEnabled()) throw new Error("GEMINI_API_KEY not configured");
  if (!isAiPilotLead(lead.ownerId as string | undefined)) {
    throw new Error("Gemini Intelligence pilot is only available for Lalit Sharma's leads");
  }

  const userPrompt = buildLeadPrompt(lead);
  const startMs = Date.now();
  const key = process.env.GEMINI_API_KEY!.trim();

  // Gemini requires JSON mode via responseMimeType
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: INTELLIGENCE_SYSTEM_PROMPT }],
        },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 32000,
          responseMimeType: "application/json",
        },
      }),
    });

    const ms = Date.now() - startMs;
    const body = await res.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      error?: { message?: string; status?: string };
    };

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${body.error?.message ?? "unknown"}`);
    }

    const rawText = body.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
    const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
    const costMicroUsd = Math.round(
      (inputTokens / 1_000_000) * COST_INPUT_PER_M * 1_000_000 +
      (outputTokens / 1_000_000) * COST_OUTPUT_PER_M * 1_000_000
    );

    let result: IntelligenceResult;
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      result = JSON.parse(cleaned) as IntelligenceResult;
    } catch {
      await prisma.aiUsageLog.create({
        data: { provider: "gemini", model: MODEL_KEY, feature: "gemini_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
      }).catch(() => {});
      throw new Error(`Gemini returned invalid JSON. Preview: ${rawText.slice(0, 200)}`);
    }

    const [analysis] = await prisma.$transaction([
      prisma.aiAnalysis.create({
        data: {
          leadId: lead.id,
          triggeredBy,
          triggeredById,
          resultJson: JSON.stringify(result),
          model: MODEL_KEY,
          inputTokens,
          outputTokens,
          costMicroUsd,
          ok: true,
        },
      }),
      prisma.aiUsageLog.create({
        data: { provider: "gemini", model: MODEL_KEY, feature: "gemini_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: true },
      }),
    ]);

    return { analysisId: analysis.id, result };
  } catch (e) {
    const ms = Date.now() - startMs;
    await prisma.aiUsageLog.create({
      data: { provider: "gemini", model: MODEL_KEY, feature: "gemini_intelligence", leadId: lead.id, ms, ok: false },
    }).catch(() => {});
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export async function getLatestGeminiIntelligence(leadId: string) {
  return prisma.aiAnalysis.findFirst({
    where: { leadId, model: MODEL_KEY },
    orderBy: { createdAt: "desc" },
  });
}

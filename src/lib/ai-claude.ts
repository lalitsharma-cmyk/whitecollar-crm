import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildLeadPrompt, isAiPilotLead, type LeadForAnalysis } from "@/lib/ai-openai";

// ─────────────────────────────────────────────────────────────────────────────
// Claude Sonnet 4.6 Sales Intelligence Layer for White Collar Realty CRM
// Pilot scope: Lalit Sharma's leads ONLY (ownerId === LALIT_ID)
//
// PURPOSE: Strategic sales intelligence — NOT CRM field extraction.
// CRM field extraction is handled by GPT-4.1-mini (ai-openai.ts).
// Claude's job: understand WHY a deal hasn't closed and HOW to close it.
// NEVER modifies CRM fields. All output is advisory only.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";
const LALIT_ID = "cmplo0t6v0000vpxslasvbwuq";

// Claude Sonnet 4.6 pricing (USD per 1M tokens)
const COST_INPUT_PER_M  = 3.00;
const COST_OUTPUT_PER_M = 15.00;

export function claudeEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

export { isAiPilotLead, LALIT_ID };

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — sales intelligence focus, NOT field extraction
// ─────────────────────────────────────────────────────────────────────────────
const ABBREVIATIONS = `
SV = Site Visit
VM = Virtual Meeting / Virtual Call
VC = Virtual Call
OM = Office Meeting
F2F = Face to Face
RTM = Ready To Move
EOI = Expression Of Interest
CP = Channel Partner
Inv = Investor
Enduse = End User
NRP = Not Responding
DSH = Details Shared
WA = WhatsApp
BHK = Bedroom Hall Kitchen
Cr = Crore (10 million INR)
L = Lakh (100,000 INR)
M = Million
AED = UAE Dirham
INR = Indian Rupee
`;

const SYSTEM_PROMPT = `You are a senior sales strategist and closing specialist for White Collar Realty — a Dubai + India property investment firm targeting HNI Indian investors.

You deeply understand:
- Indian investor psychology and buying patterns
- Dubai property investment value propositions (Golden Visa, rental yields, developer payment plans)
- Real estate sales cycles, objections, and closing techniques
- How to read between the lines of CRM remarks to understand real client sentiment

## Your Role
You are NOT extracting CRM fields. That is done separately.
Your job: read the complete lead profile and conversation history, then generate STRATEGIC SALES INTELLIGENCE that helps the sales team close this specific deal.

Everything you generate must be:
- Specific to THIS client (not generic advice)
- Based on ACTUAL data in the conversation
- Actionable and immediately usable by the sales agent

## Abbreviation Dictionary
${ABBREVIATIONS}

## Rules
1. Be specific — reference actual quotes, dates, and facts from the data
2. Never give generic advice — tailor everything to this exact client
3. If data is insufficient for a section, say so explicitly rather than inventing
4. For WhatsApp/email drafts — use the client's name and actual situation
5. Drafts must sound human, not template-like
6. Return ONLY valid JSON. No markdown, no text outside the JSON.

## Output JSON Schema
Return exactly this structure:

{
  "summary": {
    "whoIsClient": "string — profession, background, investor/enduser, family situation",
    "whatTheyWant": "string — specific requirements, budget, configuration, location",
    "whatHappenedSoFar": "string — journey so far: meetings, projects shown, responses",
    "buyingJourneyStage": "Awareness|Consideration|Evaluation|DecisionPending|ReadyToBook|Stalled|Dormant"
  },
  "whyNotClosed": {
    "biggestBlocker": "string — the #1 reason this deal hasn't closed",
    "hiddenObjection": "string|null — underlying concern not explicitly stated",
    "missingInformation": ["string — what data/answer would unblock this lead"],
    "buyingTrigger": "string|null — what event or factor would make them book",
    "delayReason": "string|null — why they are delaying specifically"
  },
  "closingProbability": {
    "classification": "VeryHigh|High|Medium|Low|Dead",
    "percentage": 0,
    "reasoning": "string — specific reasons based on actual conversation data"
  },
  "nextBestAction": {
    "action": "Call|WhatsApp|Email|OfficeMeeting|VirtualMeeting|SiteVisit|LongTermFollowUp|Revival",
    "reasoning": "string — why this specific action, based on conversation history",
    "urgency": "Immediate|Today|ThisWeek|NextWeek|NextMonth",
    "specificInstructions": "string — exact talking point or approach to use"
  },
  "callStrategy": {
    "objective": "string — the ONE goal for the next call",
    "talkingPoints": ["string"],
    "questionsToAsk": ["string — open-ended questions to uncover real objections"],
    "objectionsToHandle": ["string — specific objections this client has raised"]
  },
  "whatsAppDraft": "string — personalized, conversational, references actual discussion. Max 3 sentences.",
  "emailDraft": {
    "subject": "string",
    "body": "string — professional, references actual lead situation and projects discussed",
    "cta": "string — single specific call to action"
  },
  "alternativeProjects": [
    {
      "projectName": "string",
      "reason": "string — why this fits better than what was discussed",
      "angle": "BetterBudget|BetterConfig|BetterROI|BetterLocation|BetterTimeline"
    }
  ],
  "revivalIntelligence": {
    "isWorthAttempting": true,
    "confidence": 0,
    "reason": "string",
    "angle": "string|null — specific hook to re-engage",
    "suggestedMessage": "string|null — exact revival message to send"
  },
  "managementInsights": {
    "deservesSeniorAttention": false,
    "seniorAttentionReason": "string|null",
    "isLowPriority": false,
    "lowPriorityReason": "string|null",
    "conversionRank": "Top|High|Average|Low",
    "needsEscalation": false,
    "escalationReason": "string|null",
    "estimatedDaysToClose": null
  }
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Main intelligence function
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeLeadWithClaude(
  lead: LeadForAnalysis,
  triggeredById: string,
  triggeredBy: "manual" | "re-analyze" = "manual"
): Promise<{ analysisId: string; result: Record<string, unknown> }> {
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
      max_tokens: 6000,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userPrompt },
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
  const rawText = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const content = "{" + rawText;

  const inputTokens = msg.usage?.input_tokens ?? 0;
  const outputTokens = msg.usage?.output_tokens ?? 0;
  const costMicroUsd = Math.round(
    (inputTokens / 1_000_000) * COST_INPUT_PER_M * 1_000_000 +
    (outputTokens / 1_000_000) * COST_OUTPUT_PER_M * 1_000_000
  );

  let result: Record<string, unknown>;
  try {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    result = JSON.parse(cleaned);
  } catch {
    await prisma.aiUsageLog.create({
      data: { provider: "anthropic", model: MODEL, feature: "claude_intelligence", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
    }).catch(() => {});
    const preview = content.slice(0, 200).replace(/\n/g, " ");
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

// ─────────────────────────────────────────────────────────────────────────────
// Latest Claude analysis fetcher (filtered to Claude model only)
// ─────────────────────────────────────────────────────────────────────────────
export async function getLatestClaudeAnalysis(leadId: string) {
  return prisma.aiAnalysis.findFirst({
    where: { leadId, model: "claude-sonnet-4-6" },
    orderBy: { createdAt: "desc" },
  });
}

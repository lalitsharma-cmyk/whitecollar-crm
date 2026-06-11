import "server-only";
import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// GPT-4.1-mini CRM Extraction Engine for White Collar Realty CRM
// Pilot scope: Lalit Sharma's leads ONLY (ownerId === LALIT_ID)
// Responsibility: Extract and suggest CRM field values from conversation history.
// NEVER modifies CRM fields. All output is suggestion-only.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL = "gpt-4.1-mini";
const LALIT_ID = "cmplo0t6v0000vpxslasvbwuq";

// GPT-4.1-mini pricing (USD per 1M tokens, 2025 list)
const COST_INPUT_PER_M  = 0.40;
const COST_OUTPUT_PER_M = 1.60;

export function openAiEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

// Guard: only run AI on Lalit's leads
export function isAiPilotLead(ownerId: string | null | undefined): boolean {
  return ownerId === LALIT_ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// Abbreviation dictionary — shared with the system prompt
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

// ─────────────────────────────────────────────────────────────────────────────
// System prompt
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior real estate sales intelligence analyst for White Collar Realty (Dubai + India properties).
You deeply understand Indian real estate sales shorthand, messy CRM remarks, WhatsApp abbreviations, and Dubai property investment workflows.

Your job: analyze a lead's complete conversation history and produce a structured JSON analysis.

## Abbreviation Dictionary
${ABBREVIATIONS}

## Critical Rules
1. NEVER invent values. If information is not present in the data, say null or "Not mentioned".
2. For EVERY extracted value, cite the EXACT source remark (date + brief text).
3. "Meeting planned" is NOT the same as "Meeting completed". Only mark as completed if the remark confirms it happened.
4. Do NOT count third-party meetings (client meeting someone else) as WCR meetings.
5. Distinguish between project MENTIONED vs project client is GENUINELY INTERESTED in.
6. If uncertain, flag for human review rather than guessing.
7. Return ONLY valid JSON. No markdown, no explanation text outside the JSON.

## Meeting Completion Evidence (count as completed ONLY if remark contains words like):
- "meeting done", "met client", "office meeting completed", "client came to office", "virtual meeting done", "zoom done", "vc done"
- "site visit done", "visited project", "saw sample apartment", "saw actual unit", "visited site", "came to project", "sv done"

## Output JSON Schema
Return exactly this structure (all fields required, use null for unknown):

{
  "summary": "2-3 sentence executive summary of this lead",
  "fieldExtraction": {
    "budget": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "authority": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "need": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "timeline": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "profession": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "company": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "city": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "country": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "configuration": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "meetingStatus": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "siteVisitStatus": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "virtualMeetingStatus": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "nextAction": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "leadTemperature": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "objection": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "decisionMaker": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "familyInvolvement": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"},
    "investmentPurpose": {"currentCrmValue": "string|null", "aiSuggestedValue": "string|null", "confidence": 0-100, "sourceRemark": "string|null", "reasoning": "string"}
  },
  "bant": {
    "budget": {"value": "string|null", "currency": "INR|AED|null", "range": "string|null", "isConfirmed": true|false, "confidence": 0-100, "sourceRemark": "string|null"},
    "authority": {"decisionMaker": "string|null", "othersInvolved": ["string"], "confidence": 0-100, "sourceRemark": "string|null"},
    "need": {"configuration": "string|null", "propertyType": "string|null", "purpose": "Investor|EndUser|HolidayHome|Rental|GoldenVisa|null", "details": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "timeline": {"label": "Immediate|Within30Days|3Months|6Months|AfterDubaiVisit|AfterFamilyDiscussion|FutureBuyer|NoTimeline|null", "details": "string|null", "confidence": 0-100, "sourceRemark": "string|null"}
  },
  "clientInfo": {
    "email": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "altPhone": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "profession": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "company": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "city": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "country": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "decisionMaker": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "familyInvolvement": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "brokerInvolved": {"value": true|false|null, "confidence": 0-100, "sourceRemark": "string|null"},
    "investmentPurpose": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"},
    "fundReadiness": {"value": "string|null", "confidence": 0-100, "sourceRemark": "string|null"}
  },
  "projectsDiscussed": [
    {"name": "string", "dateDiscussed": "string|null", "context": "string", "clientReaction": "string|null", "agent": "string|null", "status": "mentioned|shared|shortlisted|visited|rejected|liked", "sourceRemark": "string"}
  ],
  "interestedProperties": [
    {"projectName": "string", "configuration": "string|null", "unit": "string|null", "budget": "string|null", "paymentPlanInterest": true|false, "reasonForInterest": "string|null", "objection": "string|null", "currentStatus": "string"}
  ],
  "meetings": {
    "completed": [{"type": "Office|SiteVisit|Virtual|Expo|Home", "date": "string|null", "agent": "string|null", "notes": "string|null", "sourceRemark": "string", "confidence": 0-100}],
    "planned": [{"type": "string", "date": "string|null", "notes": "string|null", "confidence": 0-100}]
  },
  "scheduling": {
    "recommendedNextAction": "string",
    "recommendedFollowUpDate": "string|null",
    "reason": "string",
    "confidence": 0-100,
    "sourceRemark": "string|null"
  },
  "leadQuality": {
    "classification": "Hot|Warm|Cold|RevivalCandidate|DeadLead|NeedsSeniorIntervention|NeedsProjectChange|NeedsBudgetFitOption",
    "closingProbability": "High|Medium|Low",
    "reason": "string",
    "biggestBlocker": "string|null",
    "missingInfo": ["string"],
    "whyNotClosed": "string|null",
    "leadStatus": "Active|LongTermFollowUp|Revival|ShouldClose"
  },
  "objections": [
    {"type": "string", "description": "string", "handling": "string", "sourceRemark": "string|null"}
  ],
  "salesStrategy": {
    "recommendedProject": "string|null",
    "recommendedCommunicationChannel": "Call|WhatsApp|Email",
    "recommendedFollowUpTiming": "string",
    "alternativeProjects": ["string"],
    "opportunityAngle": "string|null"
  },
  "nextBestAction": {"action": "string", "reason": "string"},
  "whatsAppDraft": "string",
  "emailDraft": {"subject": "string", "body": "string", "cta": "string"},
  "callStrategy": {
    "objective": "string",
    "talkingPoints": ["string"],
    "questionsToAsk": ["string"],
    "objectionsToHandle": ["string"]
  },
  "fieldsNeedingReview": [{"field": "string", "reason": "string"}],
  "overallConfidence": 0-100,
  "abbreviationsFound": {}
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Lead data assembler — builds the user prompt from all CRM fields + history
// ─────────────────────────────────────────────────────────────────────────────
export type LeadForAnalysis = {
  id: string;
  ownerId?: string | null;
  name: string;
  altName?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  company?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  source?: string;
  status?: string;
  currentStatus?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string;
  configuration?: string | null;
  notesShort?: string | null;
  remarks?: string | null;
  clientType?: string | null;
  whoIsClient?: string | null;
  whenCanInvest?: string | null;
  potential?: string | null;
  fundReadiness?: string | null;
  moodStatus?: string | null;
  bantStatus?: string | null;
  authorityLevel?: string | null;
  authorityPerson?: string | null;
  needSummary?: string | null;
  profession?: string | null;
  todoNext?: string | null;
  aiNextAction?: string | null;
  meetingDate?: Date | null;
  siteVisitDate?: Date | null;
  followupDate?: Date | null;
  createdAt: Date;
  lastTouchedAt?: Date | null;
  owner?: { name: string } | null;
  discussed?: Array<{ project: { name: string; city?: string | null }; status: string; notes?: string | null; discussedAt: Date }>;
  activities?: Array<{ type: string; status: string; title: string; description?: string | null; scheduledAt?: Date | null; completedAt?: Date | null; user?: { name: string } | null; createdAt: Date }>;
  callLogs?: Array<{ direction: string; outcome: string; notes?: string | null; attributedAgentName?: string | null; startedAt: Date; user: { name: string } }>;
  notes?: Array<{ body: string; createdAt: Date; user?: { name: string } | null }>;
};

export function buildLeadPrompt(lead: LeadForAnalysis): string {
  const lines: string[] = [];

  lines.push(`=== LEAD PROFILE ===`);
  lines.push(`Name: ${lead.name}${lead.altName ? ` / ${lead.altName}` : ""}`);
  lines.push(`Phone: ${lead.phone ?? "Not provided"}${lead.altPhone ? ` | Alt: ${lead.altPhone}` : ""}`);
  lines.push(`Email: ${lead.email ?? "Not provided"}`);
  lines.push(`Company: ${lead.company ?? "Not mentioned"}`);
  lines.push(`City: ${lead.city ?? "Not mentioned"} | Country: ${lead.country ?? "Not mentioned"}`);
  lines.push(`Enquiry Date: ${lead.createdAt.toISOString().split("T")[0]}`);
  lines.push(`Source: ${lead.source ?? "—"}`);
  lines.push(`CRM Stage: ${lead.status ?? "—"} | Status: ${lead.currentStatus ?? "—"}`);
  lines.push(`Assigned To: ${lead.owner?.name ?? "Unassigned"}`);

  lines.push(`\n=== REQUIREMENTS (CRM Fields) ===`);
  if (lead.budgetMin) {
    const ccy = lead.budgetCurrency ?? "AED";
    const budgetStr = ccy === "INR"
      ? `₹${(lead.budgetMin / 10_000_000).toFixed(1)} Cr${lead.budgetMax ? ` – ₹${(lead.budgetMax / 10_000_000).toFixed(1)} Cr` : ""}`
      : `AED ${(lead.budgetMin / 1_000_000).toFixed(1)} M${lead.budgetMax ? ` – AED ${(lead.budgetMax / 1_000_000).toFixed(1)} M` : ""}`;
    lines.push(`Budget: ${budgetStr}`);
  } else {
    lines.push(`Budget: Not set in CRM`);
  }
  lines.push(`Configuration: ${lead.configuration ?? "Not set"}`);
  lines.push(`Notes: ${lead.notesShort ?? "None"}`);
  lines.push(`Client Type: ${lead.clientType ?? "Not set"}`);
  lines.push(`Who is Client: ${lead.whoIsClient ?? "Not set"}`);
  lines.push(`Investment Timeline: ${lead.whenCanInvest ?? "Not set"}`);
  lines.push(`Fund Readiness: ${lead.fundReadiness ?? "Not set"}`);
  lines.push(`Potential: ${lead.potential ?? "Not set"}`);
  lines.push(`Mood: ${lead.moodStatus ?? "Not set"}`);
  lines.push(`BANT Status: ${lead.bantStatus ?? "UNDER_REVIEW"}`);
  lines.push(`Authority Level: ${lead.authorityLevel ?? "Not set"} | Person: ${lead.authorityPerson ?? "Not set"}`);
  lines.push(`Need Summary: ${lead.needSummary ?? "Not set"}`);
  lines.push(`Profession: ${lead.profession ?? "Not set"}`);
  lines.push(`Next Action (CRM): ${lead.todoNext ?? "Not set"}`);
  if (lead.followupDate) lines.push(`Follow-up Date: ${lead.followupDate.toISOString().split("T")[0]}`);
  if (lead.meetingDate) lines.push(`Meeting Date (CRM field): ${lead.meetingDate.toISOString().split("T")[0]}`);
  if (lead.siteVisitDate) lines.push(`Site Visit Date (CRM field): ${lead.siteVisitDate.toISOString().split("T")[0]}`);
  lines.push(`Last Touched: ${lead.lastTouchedAt ? lead.lastTouchedAt.toISOString().split("T")[0] : "Unknown"}`);

  // Projects discussed
  if (lead.discussed && lead.discussed.length > 0) {
    lines.push(`\n=== PROJECTS DISCUSSED (CRM) ===`);
    for (const d of lead.discussed) {
      lines.push(`- ${d.project.name} (${d.project.city ?? "?"}) | Status: ${d.status} | Date: ${d.discussedAt.toISOString().split("T")[0]}${d.notes ? ` | Notes: ${d.notes}` : ""}`);
    }
  }

  // Call logs
  const realCalls = (lead.callLogs ?? []).filter(c => c.attributedAgentName == null);
  if (realCalls.length > 0) {
    lines.push(`\n=== CALL HISTORY (${realCalls.length} calls) ===`);
    for (const c of realCalls.slice(0, 30)) {
      const agent = c.user.name;
      const date = c.startedAt.toISOString().split("T")[0];
      lines.push(`[${date}] ${agent} → ${c.direction} | Outcome: ${c.outcome}${c.notes ? ` | Notes: ${c.notes}` : ""}`);
    }
  }

  // Activities
  const acts = (lead.activities ?? []).filter(a => a.type !== "LEAD_CREATED");
  if (acts.length > 0) {
    lines.push(`\n=== ACTIVITIES ===`);
    for (const a of acts.slice(0, 20)) {
      const agent = a.user?.name ?? "—";
      const date = (a.completedAt ?? a.scheduledAt ?? a.createdAt).toISOString().split("T")[0];
      lines.push(`[${date}] ${a.type} | ${a.status} | ${a.title}${a.description ? ` — ${a.description}` : ""} | By: ${agent}`);
    }
  }

  // Notes
  const notes = lead.notes ?? [];
  if (notes.length > 0) {
    lines.push(`\n=== NOTES ===`);
    for (const n of notes.slice(0, 20)) {
      const agent = n.user?.name ?? "—";
      const date = n.createdAt.toISOString().split("T")[0];
      lines.push(`[${date}] ${agent}: ${n.body}`);
    }
  }

  // Main remarks (imported Excel / conversation history)
  if (lead.remarks && lead.remarks.trim()) {
    lines.push(`\n=== CONVERSATION HISTORY / IMPORTED REMARKS ===`);
    lines.push(lead.remarks.slice(0, 8000)); // cap at 8k chars to avoid token explosion
  }

  lines.push(`\n=== END OF LEAD DATA ===`);
  lines.push(`\nNow analyze this lead and return your JSON response. Remember: cite exact source remarks, never invent data, distinguish planned vs completed meetings.`);

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main analysis function
// ─────────────────────────────────────────────────────────────────────────────
export async function analyzeLeadWithAI(
  lead: LeadForAnalysis,
  triggeredById: string,
  triggeredBy: "manual" | "re-analyze" = "manual"
): Promise<{ analysisId: string; result: Record<string, unknown> }> {
  if (!openAiEnabled()) throw new Error("OPENAI_API_KEY not configured");
  if (!isAiPilotLead(lead.ownerId as string | undefined)) {
    throw new Error("AI pilot is only available for Lalit Sharma's leads");
  }

  const userPrompt = buildLeadPrompt(lead);
  const startMs = Date.now();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    }),
  });

  const ms = Date.now() - startMs;

  if (!response.ok) {
    const errText = await response.text();
    await prisma.aiUsageLog.create({
      data: { provider: "openai", model: MODEL, feature: "copilot_extraction", leadId: lead.id, ms, ok: false },
    }).catch(() => {});
    throw new Error(`OpenAI API error ${response.status}: ${errText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  const content = data.choices[0]?.message?.content ?? "";
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
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
      data: { provider: "openai", model: MODEL, feature: "copilot_extraction", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: false },
    }).catch(() => {});
    const preview = content.slice(0, 200).replace(/\n/g, " ");
    throw new Error(`GPT returned invalid JSON. Response preview: ${preview}`);
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
      data: { provider: "openai", model: MODEL, feature: "copilot_extraction", leadId: lead.id, inputTokens, outputTokens, costMicroUsd, ms, ok: true },
    }),
  ]);

  return { analysisId: analysis.id, result };
}

// ─────────────────────────────────────────────────────────────────────────────
// Latest analysis fetcher
// ─────────────────────────────────────────────────────────────────────────────
export async function getLatestAnalysis(leadId: string) {
  return prisma.aiAnalysis.findFirst({
    where: { leadId, model: "gpt-4.1-mini" },
    orderBy: { createdAt: "desc" },
    include: { feedbacks: { orderBy: { createdAt: "desc" } } },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback recorder (Accept / Edit / Reject)
// ─────────────────────────────────────────────────────────────────────────────
export async function recordFeedback(opts: {
  analysisId: string;
  leadId: string;
  fieldName: string;
  aiValue: string;
  action: "ACCEPT" | "EDIT" | "REJECT";
  editedValue?: string;
  userId: string;
}) {
  return prisma.aiSuggestionFeedback.create({
    data: {
      analysisId: opts.analysisId,
      leadId: opts.leadId,
      fieldName: opts.fieldName,
      aiValue: opts.aiValue,
      action: opts.action,
      editedValue: opts.editedValue ?? null,
      userId: opts.userId,
    },
  });
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { generateTextWithUsage, costMicroUsd, type GenContext } from "@/lib/ai";
import { getAiExtractionAutoApply } from "@/lib/settings";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedField<T = string> {
  value: T;
  confidence: number;    // 0.0 – 1.0
  sourceText: string;    // verbatim quote from the lead's history
  sourceDate: string;    // "YYYY-MM-DD"
}

export interface ExtractedProject {
  name: string;          // EXACT name as it appears in the source text
  confidence: number;
  sourceText: string;
  sourceDate: string;
}

export interface AIExtractionResult {
  budget?:             ExtractedField | null;
  authority?:          ExtractedField | null;   // "Self" | "Wife" | "Father + Son" etc.
  need?:               ExtractedField | null;   // requirement / reason for buying
  timeline?:           ExtractedField | null;   // "3 months" | "immediate" | "6+ months"
  configuration?:      ExtractedField | null;   // "2BHK" | "3BR" | "Studio"
  locationPreference?: ExtractedField | null;
  purpose?:            ExtractedField<"investment" | "end-use" | "rental" | "resale"> | null;
  projectsDiscussed?:  ExtractedProject[];
  connectedStatus?:    ExtractedField<"connected" | "not_connected"> | null;
  bestTimeToCall?:     ExtractedField | null;
  buyingSignals?:      string[];
  objections?:         string[];
  clientSummary?:      string;
  nextBestAction?:     string;
  extractedAt:         string;
}

export type ExtractionTrigger =
  | "call_log" | "wa_message" | "voice_note"
  | "meeting_note" | "import" | "manual";

const AUTO_APPLY_THRESHOLD = 0.90;
const MIN_CONFIDENCE = 0.60;

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runAIExtraction(
  leadId: string,
  triggeredBy: ExtractionTrigger = "manual",
  ctx: GenContext = {},
): Promise<AIExtractionResult | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      notes: {
        select: { body: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      callLogs: {
        select: { outcome: true, notes: true, startedAt: true, durationSec: true, attributedAgentName: true },
        orderBy: { startedAt: "desc" },
        take: 8,
      },
      waMessages: {
        select: { body: true, direction: true, receivedAt: true },
        orderBy: { receivedAt: "desc" },
        take: 10,
      },
      discussed: {
        select: { project: { select: { name: true } }, suggestion: true },
        where: { suggestion: false },
      },
    },
  });
  if (!lead) return null;

  const history = buildHistoryText(lead);
  if (!history.trim()) return null;

  const prompt = buildExtractionPrompt(lead, history);
  const result = await generateTextWithUsage(
    { prompt, maxTokens: 1200 },
    { feature: "extraction", leadId, ...ctx },
  );

  if (result.state !== "ok" || !result.text) return null;

  const parsed = parseExtractionResult(result.text);
  if (!parsed) return null;

  // Persist extraction run
  await prisma.aiExtraction.create({
    data: {
      leadId,
      resultJson: JSON.stringify(parsed),
      triggeredBy,
      provider: result.provider ?? undefined,
      model: result.model ?? undefined,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicroUsd: costMicroUsd(result.model, result.inputTokens, result.outputTokens),
    },
  });

  // Auto-apply high-confidence fields (gated by admin setting)
  if (await getAiExtractionAutoApply()) {
    await applyHighConfidenceFields(leadId, parsed, lead);
  } else {
    // Always update AI summary fields regardless of auto-apply gate
    const aiUpdates: Record<string, unknown> = {};
    if (parsed.clientSummary) { aiUpdates.aiSummary = parsed.clientSummary; aiUpdates.aiUpdatedAt = new Date(); }
    if (parsed.nextBestAction) aiUpdates.aiNextAction = parsed.nextBestAction;
    if (Object.keys(aiUpdates).length > 0) {
      await prisma.lead.update({ where: { id: leadId }, data: aiUpdates });
    }
  }

  // Always create project suggestions (user still needs to accept/reject)
  if (parsed.projectsDiscussed?.length) {
    await upsertProjectSuggestions(leadId, parsed.projectsDiscussed);
  }

  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get latest extraction for a lead
// ─────────────────────────────────────────────────────────────────────────────

export async function getLatestExtraction(leadId: string): Promise<{ result: AIExtractionResult; createdAt: Date } | null> {
  const row = await prisma.aiExtraction.findFirst({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    select: { resultJson: true, createdAt: true },
  });
  if (!row) return null;
  try {
    const result = JSON.parse(row.resultJson) as AIExtractionResult;
    return { result, createdAt: row.createdAt };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Build history text from all lead sources
// ─────────────────────────────────────────────────────────────────────────────

function buildHistoryText(lead: {
  remarks?: string | null;
  notesShort?: string | null;
  notes: Array<{ body: string; createdAt: Date }>;
  callLogs: Array<{ outcome: string; notes?: string | null; startedAt: Date; durationSec?: number | null; attributedAgentName?: string | null }>;
  waMessages: Array<{ body: string; direction: string; receivedAt: Date }>;
}): string {
  const sections: string[] = [];

  if (lead.remarks?.trim()) {
    sections.push(`=== IMPORTED REMARKS ===\n${lead.remarks.slice(0, 2000)}`);
  }
  if (lead.notesShort?.trim()) {
    sections.push(`=== SHORT NOTE ===\n${lead.notesShort.slice(0, 500)}`);
  }

  const callsWithNotes = lead.callLogs.filter((c) => c.notes?.trim());
  if (callsWithNotes.length > 0) {
    const callText = callsWithNotes.slice(0, 6).map((c, i) => {
      const date = c.startedAt.toISOString().slice(0, 10);
      const who = c.attributedAgentName ?? "Agent";
      const dur = c.durationSec ? ` (${Math.round(c.durationSec / 60)} min)` : "";
      return `[Call ${i + 1}] ${date} · ${who} · ${c.outcome.replaceAll("_", " ")}${dur}\n${c.notes!.slice(0, 500)}`;
    }).join("\n\n");
    sections.push(`=== CALL NOTES ===\n${callText}`);
  }

  const waFiltered = lead.waMessages.filter((m) => m.body?.trim()).slice(0, 8);
  if (waFiltered.length > 0) {
    const waText = waFiltered.map((m, i) => {
      const date = m.receivedAt.toISOString().slice(0, 10);
      return `[WA ${i + 1}] ${date} · ${m.direction}: ${m.body.slice(0, 300)}`;
    }).join("\n\n");
    sections.push(`=== WHATSAPP MESSAGES ===\n${waText}`);
  }

  const validNotes = lead.notes.filter((n) => n.body?.trim());
  if (validNotes.length > 0) {
    const notesText = validNotes.slice(0, 4).map((n, i) => {
      const date = n.createdAt.toISOString().slice(0, 10);
      return `[Note ${i + 1}] ${date}\n${n.body.slice(0, 500)}`;
    }).join("\n\n");
    sections.push(`=== NOTES ===\n${notesText}`);
  }

  return sections.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Build extraction prompt
// ─────────────────────────────────────────────────────────────────────────────

function buildExtractionPrompt(
  lead: {
    name: string;
    budgetMin?: number | null;
    budgetCurrency?: string | null;
    configuration?: string | null;
    whenCanInvest?: string | null;
    authorityPerson?: string | null;
    needSummary?: string | null;
    forwardedTeam?: string | null;
    discussed: Array<{ project: { name: string } }>;
  },
  history: string,
): string {
  const confirmedProjects = lead.discussed.map((d) => d.project.name).join(", ") || "none";
  const currency = lead.budgetCurrency ?? (lead.forwardedTeam === "India" ? "INR" : "AED");

  return `You are extracting structured CRM data from a real estate lead's conversation history.

STRICT RULES — READ CAREFULLY:
1. Extract ONLY what is EXPLICITLY stated. Never infer, assume, or guess.
2. For EVERY extracted field, provide verbatim text from the source as "sourceText".
3. Confidence scale:
   - 0.90-1.00 = explicitly stated, no ambiguity
   - 0.60-0.89 = stated but slightly ambiguous
   - Below 0.60 = do NOT include (set to null)
4. "projectsDiscussed": ONLY include if the COMPLETE project name appears verbatim.
   Examples: "Sobha Hartland 2" ✓  |  "Emaar" alone ✗  |  "Hartland" alone ✗
5. "authority" = the RELATIONSHIP of the decision-maker.
   Use: "Self" | "Wife" | "Husband" | "Father" | "Mother" | "Father + Son" |
        "Parents" | "Business Partner" | "Investor Group" | "Board / Company"
6. "purpose" must be exactly one of: "investment" | "end-use" | "rental" | "resale"
7. "connectedStatus": derived from the MOST RECENT call outcome only.
   "connected" = call was picked up and a conversation happened.
   "not_connected" = not picked / busy / switched off / wrong number / callback.
8. "buyingSignals": max 8 items, max 8 words each — phrases showing buying intent.
9. "objections": max 6 items, max 8 words each — phrases showing hesitation/blockers.
10. If a field has NO evidence, return null. Do NOT invent anything.

Lead context (existing CRM values — DO NOT overwrite with lower-quality data):
- Name: ${lead.name}
- Current budget in CRM: ${lead.budgetMin ? `${currency} ${lead.budgetMin.toLocaleString()}` : "not set"}
- Current config in CRM: ${lead.configuration ?? "not set"}
- Current timeline in CRM: ${lead.whenCanInvest ?? "not set"}
- Projects already confirmed in CRM: ${confirmedProjects}

LEAD HISTORY:
${history.slice(0, 4500)}

Return ONLY valid JSON matching this exact structure. No markdown, no prose outside the JSON:
{
  "budget": {"value":"AED 1.5M","confidence":0.95,"sourceText":"exact quote from above","sourceDate":"2026-06-01"} or null,
  "authority": {"value":"Wife","confidence":0.92,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "need": {"value":"2BHK for rental yield","confidence":0.88,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "timeline": {"value":"3 months","confidence":0.90,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "configuration": {"value":"2BHK","confidence":0.95,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "locationPreference": {"value":"Business Bay","confidence":0.90,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "purpose": {"value":"investment","confidence":0.88,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "projectsDiscussed": [{"name":"Exact Full Project Name","confidence":0.98,"sourceText":"exact quote","sourceDate":"2026-06-01"}],
  "connectedStatus": {"value":"connected","confidence":0.95,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "bestTimeToCall": {"value":"evenings after 7pm","confidence":0.90,"sourceText":"exact quote","sourceDate":"2026-06-01"} or null,
  "buyingSignals": ["signal phrase 1","signal phrase 2"],
  "objections": ["objection phrase 1"],
  "clientSummary": "2-3 sentence factual summary of the client situation based ONLY on the history above",
  "nextBestAction": "specific next action based on the most recent interaction"
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse AI response
// ─────────────────────────────────────────────────────────────────────────────

function parseExtractionResult(text: string): AIExtractionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    function parseField<T = string>(v: unknown): ExtractedField<T> | null {
      if (!v || typeof v !== "object") return null;
      const f = v as Record<string, unknown>;
      if (typeof f.value === "undefined" || typeof f.confidence !== "number") return null;
      if (f.confidence < MIN_CONFIDENCE) return null;
      return {
        value: f.value as T,
        confidence: Math.min(1, Math.max(0, f.confidence)),
        sourceText: String(f.sourceText ?? "").slice(0, 300),
        sourceDate: String(f.sourceDate ?? ""),
      };
    }

    function parseProject(v: unknown): ExtractedProject | null {
      if (!v || typeof v !== "object") return null;
      const f = v as Record<string, unknown>;
      if (!f.name || typeof f.confidence !== "number" || f.confidence < MIN_CONFIDENCE) return null;
      return {
        name: String(f.name).trim(),
        confidence: Math.min(1, Math.max(0, f.confidence)),
        sourceText: String(f.sourceText ?? "").slice(0, 300),
        sourceDate: String(f.sourceDate ?? ""),
      };
    }

    const result: AIExtractionResult = { extractedAt: new Date().toISOString() };

    const budget = parseField(raw.budget);
    if (budget) result.budget = budget;

    const authority = parseField(raw.authority);
    if (authority) result.authority = authority;

    const need = parseField(raw.need);
    if (need) result.need = need;

    const timeline = parseField(raw.timeline);
    if (timeline) result.timeline = timeline;

    const configuration = parseField(raw.configuration);
    if (configuration) result.configuration = configuration;

    const locationPreference = parseField(raw.locationPreference);
    if (locationPreference) result.locationPreference = locationPreference;

    const purpose = parseField<"investment" | "end-use" | "rental" | "resale">(raw.purpose);
    if (purpose) result.purpose = purpose;

    if (Array.isArray(raw.projectsDiscussed)) {
      const projects = raw.projectsDiscussed.map(parseProject).filter((p): p is ExtractedProject => p !== null);
      if (projects.length > 0) result.projectsDiscussed = projects;
    }

    const connectedStatus = parseField<"connected" | "not_connected">(raw.connectedStatus);
    if (connectedStatus) result.connectedStatus = connectedStatus;

    const bestTimeToCall = parseField(raw.bestTimeToCall);
    if (bestTimeToCall) result.bestTimeToCall = bestTimeToCall;

    if (Array.isArray(raw.buyingSignals)) {
      result.buyingSignals = raw.buyingSignals
        .map((s: unknown) => String(s).trim())
        .filter((s) => s.length > 0 && s.length < 100)
        .slice(0, 8);
    }

    if (Array.isArray(raw.objections)) {
      result.objections = raw.objections
        .map((s: unknown) => String(s).trim())
        .filter((s) => s.length > 0 && s.length < 100)
        .slice(0, 6);
    }

    if (raw.clientSummary && typeof raw.clientSummary === "string") {
      result.clientSummary = raw.clientSummary.trim().slice(0, 600);
    }
    if (raw.nextBestAction && typeof raw.nextBestAction === "string") {
      result.nextBestAction = raw.nextBestAction.trim().slice(0, 300);
    }

    return result;
  } catch (e) {
    console.warn("aiExtractor: parseExtractionResult failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-apply high-confidence fields to Lead
// (only when ai.extraction.autoApply = "true")
// ─────────────────────────────────────────────────────────────────────────────

async function applyHighConfidenceFields(
  leadId: string,
  result: AIExtractionResult,
  lead: {
    authorityPerson?: string | null;
    needSummary?: string | null;
    configuration?: string | null;
  },
): Promise<void> {
  const updates: Record<string, unknown> = {};

  // authorityPerson — only if not already set by a human
  if (result.authority?.confidence && result.authority.confidence >= AUTO_APPLY_THRESHOLD) {
    if (!lead.authorityPerson || lead.authorityPerson === "Unknown") {
      updates.authorityPerson = result.authority.value;
    }
  }

  // needSummary — only if empty
  if (result.need?.confidence && result.need.confidence >= AUTO_APPLY_THRESHOLD && !lead.needSummary) {
    updates.needSummary = result.need.value;
  }

  // configuration — only if empty
  if (result.configuration?.confidence && result.configuration.confidence >= AUTO_APPLY_THRESHOLD && !lead.configuration) {
    updates.configuration = result.configuration.value;
  }

  // AI summary fields — always update
  if (result.clientSummary) { updates.aiSummary = result.clientSummary; updates.aiUpdatedAt = new Date(); }
  if (result.nextBestAction) updates.aiNextAction = result.nextBestAction;

  if (Object.keys(updates).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data: updates });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create LeadProject suggestion rows for AI-identified projects
// ─────────────────────────────────────────────────────────────────────────────

async function upsertProjectSuggestions(
  leadId: string,
  projects: ExtractedProject[],
): Promise<void> {
  for (const p of projects) {
    const dbProject = await prisma.project.findFirst({
      where: { name: { equals: p.name, mode: "insensitive" } },
      select: { id: true },
    });
    if (!dbProject) continue;

    await prisma.leadProject.upsert({
      where: { leadId_projectId: { leadId, projectId: dbProject.id } },
      create: {
        leadId,
        projectId: dbProject.id,
        autoDetected: true,
        suggestion: true,
        sourceType: "CALL_NOTE",
        sourceText: p.sourceText.slice(0, 200),
      },
      update: {
        sourceText: p.sourceText.slice(0, 200),
      },
    });
  }
}

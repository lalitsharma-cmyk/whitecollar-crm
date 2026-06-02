import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// ─────────────────────────────────────────────────────────────────────────────
// Provider selection
//
// Two providers supported:
//   • GEMINI  (FREE — Google AI Studio, ~1500 req/day) ← preferred default
//   • ANTHROPIC (paid — Claude, ~₹2-4 per analysis)
//
// Set ONE of GEMINI_API_KEY or ANTHROPIC_API_KEY in Vercel env vars. If both
// are set, Gemini wins (it's free). If neither is set, every AI call falls
// back to the rule-based path so the CRM still works without burning credit.
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";
// gemini-1.5-flash is the safest free-tier default in 2026 — Google removed
// gemini-2.0-flash from the no-billing free tier (returns RESOURCE_EXHAUSTED
// with "limit: 0" for accounts without billing enabled). 1.5-flash is still
// generously free (15 req/min, 1500 req/day) and excellent for lead
// summarisation — that's what we actually need.
// Override via GEMINI_MODEL env var when billing is enabled and you want the
// smarter models: "gemini-2.0-flash", "gemini-2.5-flash", "gemini-1.5-pro".
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

type Provider = "gemini" | "anthropic" | null;

export function aiProvider(): Provider {
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  return null;
}

export function aiEnabled() {
  return aiProvider() !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic text-generation wrapper. Abstracts the two provider HTTP shapes so
// the rest of the lib stays simple. Returns null when no provider is configured
// — callers handle that fallback.
// ─────────────────────────────────────────────────────────────────────────────

interface GenArgs {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export async function generateText({ system, prompt, maxTokens = 600 }: GenArgs): Promise<string | null> {
  const provider = aiProvider();
  if (provider === "gemini") return geminiGenerate({ system, prompt, maxTokens });
  if (provider === "anthropic") return anthropicGenerate({ system, prompt, maxTokens });
  return null;
}

async function geminiGenerate({ system, prompt, maxTokens }: Required<Pick<GenArgs, "prompt" | "maxTokens">> & { system?: string }): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY!;
  // Gemini's REST API. Using raw fetch keeps us free of @google/generative-ai
  // as a dependency. The system instruction goes in a dedicated field on v1beta.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.4,
        },
      }),
    });
    if (!r.ok) {
      const errBody = await r.text();
      console.error("Gemini error", r.status, errBody.slice(0, 200));
      return null;
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    return text || null;
  } catch (e) {
    console.error("Gemini fetch failed", e);
    return null;
  }
}

async function anthropicGenerate({ system, prompt, maxTokens }: Required<Pick<GenArgs, "prompt" | "maxTokens">> & { system?: string }): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY!;
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  } catch (e) {
    console.error("Anthropic call failed", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead scoring (existing API — refactored to use generateText)
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadForAI {
  name: string;
  source: string;
  status: string;
  currentStatus?: string | null;
  city?: string | null;
  country?: string | null;
  company?: string | null;
  configuration?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
  whoIsClient?: string | null;
  potential?: string | null;
  fundReadiness?: string | null;
  whenCanInvest?: string | null;
  moodStatus?: string | null;
  categorization?: string | null;
  remarks?: string | null;
  todoNext?: string | null;
  tags?: string | null;
  daysOld: number;
  activityCount: number;
  callsConnected: number;
  lastTouchDaysAgo: number | null;
  interestedProject?: string | null;
}

export interface AIScoreResult {
  score: number;
  bucket: "HOT" | "WARM" | "COLD";
  summary: string;
  nextAction: string;
}

export async function scoreLead(lead: LeadForAI): Promise<AIScoreResult> {
  if (!aiEnabled()) return ruleBasedScore(lead);

  const prompt = `You are an expert real-estate sales analyst for a Dubai property investment firm.
The "Who Is The Client" narrative is the PRIMARY signal — it captures the full client situation, not keywords.
Read it carefully. Then weigh fund readiness, timeline, potential, and engagement.

Score 0-100 for likelihood of booking within 30 days, classify HOT/WARM/COLD,
write a 2-sentence summary that references the actual client situation (not generic phrases),
and a 1-sentence next-best-action that's specific to this person.

Reply STRICTLY as JSON: {"score":N,"bucket":"HOT|WARM|COLD","summary":"...","nextAction":"..."}.

CLIENT:
${lead.whoIsClient ? `▶ Who is the client (FULL situation):\n${lead.whoIsClient}\n` : "▶ (No client narrative captured yet — score conservatively)\n"}

Profile:
- Name: ${lead.name}
- Company: ${lead.company ?? "?"}
- Location: ${lead.city ?? "?"}, ${lead.country ?? "?"}
- Categorization: ${lead.categorization ?? "?"}
- Looking for: ${lead.configuration ?? "?"}
- Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"} - ${lead.budgetMax ?? "?"}
- Interested project: ${lead.interestedProject ?? "—"}

Qualification signals:
- Potential: ${lead.potential ?? "?"}
- Fund readiness: ${lead.fundReadiness ?? "?"}
- When can invest: ${lead.whenCanInvest ?? "?"}
- Mood: ${lead.moodStatus ?? "?"}

Funnel:
- Stage: ${lead.status}
- Current status: ${lead.currentStatus ?? "—"}
- Source: ${lead.source}
- Days in pipeline: ${lead.daysOld}
- Activities: ${lead.activityCount} · Connected calls: ${lead.callsConnected}
- Last touch: ${lead.lastTouchDaysAgo == null ? "never" : `${lead.lastTouchDaysAgo}d ago`}
- Remarks: ${lead.remarks ?? "—"}`;

  const text = await generateText({ prompt, maxTokens: 400 });
  if (!text) return ruleBasedScore(lead);
  try {
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    return {
      score: Math.max(0, Math.min(100, Number(json.score) || 0)),
      bucket: json.bucket === "HOT" || json.bucket === "WARM" || json.bucket === "COLD" ? json.bucket : "COLD",
      summary: String(json.summary ?? ""),
      nextAction: String(json.nextAction ?? ""),
    };
  } catch {
    return ruleBasedScore(lead);
  }
}

function ruleBasedScore(lead: LeadForAI): AIScoreResult {
  let score = 30;
  if (lead.whoIsClient && lead.whoIsClient.length > 100) score += 15;
  if (lead.potential === "HIGH") score += 20;
  else if (lead.potential === "MEDIUM") score += 8;
  if (lead.fundReadiness === "CASH_READY") score += 18;
  else if (lead.fundReadiness === "BANK_APPROVED") score += 12;
  if (lead.whenCanInvest === "IMMEDIATE") score += 15;
  else if (lead.whenCanInvest === "THIRTY_DAYS") score += 10;
  if (lead.moodStatus === "EXCITED") score += 8;
  else if (lead.moodStatus === "INTERESTED") score += 5;
  else if (lead.moodStatus === "COLD" || lead.moodStatus === "ANGRY") score -= 10;
  if (lead.callsConnected > 0) score += 8;
  if (lead.lastTouchDaysAgo != null && lead.lastTouchDaysAgo > 7) score -= 10;
  if (["QUALIFIED", "SITE_VISIT", "NEGOTIATION"].includes(lead.status)) score += 10;
  score = Math.max(0, Math.min(100, score));
  const bucket = score >= 75 ? "HOT" : score >= 50 ? "WARM" : "COLD";
  return {
    score, bucket,
    summary: `Rule-based (no AI key set): ${bucket.toLowerCase()} lead, ${lead.fundReadiness ?? "fund readiness unknown"}, ${lead.whenCanInvest ?? "timeline unknown"}. Set GEMINI_API_KEY (free) in .env for narrative-aware AI scoring that reads "Who Is Client".`,
    nextAction: bucket === "HOT" ? (lead.todoNext ?? "Call now and propose a site visit this week.") : bucket === "WARM" ? "Send a personalised WhatsApp follow-up referencing their stated need." : "Add to nurture drip; revisit in 30 days.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI-driven structured score  (NEW — Agent I)
//
// Called from leadRescorer.rescoreLead AFTER the rule-based numeric is computed.
// Uses a compact context (recent activities, recent WA messages, BANT verdict,
// budget, days since contact, pre-extracted buying signals) so we don't blow
// the prompt budget on huge histories.
//
// Returns a structured JSON envelope. The contract is documented inline below
// so future agents don't have to grep for it.
// ─────────────────────────────────────────────────────────────────────────────

export interface AIScoreLeadInput {
  leadId: string;
  name: string;
  company?: string | null;
  whoIsClient?: string | null;
  bantStatus?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
  configuration?: string | null;
  remarks?: string | null;
  currentStatus?: string | null;
  status?: string | null;
  whenCanInvest?: string | null;
  potential?: string | null;
  fundReadiness?: string | null;
  moodStatus?: string | null;
  categorization?: string | null;
  recentActivities: Array<{ type: string; status: string; title?: string | null; createdAt: Date }>;
  recentWA: Array<{ direction: string; body: string; receivedAt: Date }>;
  buyingSignals: string[];
  lastTouchDaysAgo: number;
}

export interface AIScoreLeadResult {
  score: "HOT" | "WARM" | "COLD";
  value: number; // 0-100
  whyShort: string; // 1-sentence explanation — surfaces in BuyingSignalsCard
  buyingSignals: string[];
  risks: string[];
  nextAction: string;
}

export async function aiScoreLead(input: AIScoreLeadInput): Promise<AIScoreLeadResult | null> {
  if (!aiEnabled()) return null;

  const acts = input.recentActivities
    .slice(0, 6)
    .map(
      (a, i) =>
        `${i + 1}. ${a.createdAt.toISOString().slice(0, 10)} · ${a.type} · ${a.status}${a.title ? ` — ${a.title}` : ""}`,
    )
    .join("\n");
  const wa = input.recentWA
    .slice(0, 3)
    .map(
      (m, i) =>
        `${i + 1}. ${m.receivedAt.toISOString().slice(0, 10)} · ${m.direction} — ${(m.body ?? "").slice(0, 240)}`,
    )
    .join("\n");
  const sigs = input.buyingSignals.length ? input.buyingSignals.map((s) => `• ${s}`).join("\n") : "(none detected)";

  const prompt = `You are a senior real-estate sales coach scoring a Dubai property lead for likelihood-to-close within 30 days.

Reply STRICTLY as JSON with this exact shape (no markdown, no prose outside the JSON):
{"score":"HOT|WARM|COLD","value":0-100,"whyShort":"1 sentence","buyingSignals":["..."],"risks":["..."],"nextAction":"1 sentence, specific action"}

Scoring guidance:
- HOT  ≥ 70: BANT qualifies AND late-funnel (NEGOTIATION/SITE_VISIT/BOOKING_DONE) or immediate timeline AND clear buying intent in last 14d.
- WARM 40-69: qualified or under-review, engaged (a connected call), touched in last 14d, no killer risk.
- COLD < 40: stalled, ghosting, no contact 30+ days, unqualified, or zero engagement.

Use the buying-signal hits below as evidence — do not invent signals not in the data.
"whyShort" must reference the actual situation, not generic phrases.

LEAD: ${input.name}${input.company ? ` · ${input.company}` : ""}
BANT: ${input.bantStatus ?? "—"} · Stage: ${input.status ?? "—"} · Current: ${input.currentStatus ?? "—"}
Budget: ${input.budgetCurrency ?? "AED"} ${input.budgetMin ?? "?"} - ${input.budgetMax ?? "?"} · Looking for: ${input.configuration ?? "—"}
Timeline: ${input.whenCanInvest ?? "—"} · Fund: ${input.fundReadiness ?? "—"} · Potential: ${input.potential ?? "—"} · Mood: ${input.moodStatus ?? "—"}
Categorization: ${input.categorization ?? "—"} · Last touch: ${input.lastTouchDaysAgo}d ago

Who is the client:
${input.whoIsClient ?? "(no narrative)"}

Pre-extracted buying signals (last 14d):
${sigs}

Recent activities (max 6):
${acts || "(none)"}

Recent WhatsApp (max 3):
${wa || "(none)"}

Remarks (truncated):
${(input.remarks ?? "").slice(0, 1200)}`;

  const text = await generateText({ prompt, maxTokens: 500 });
  if (!text) return null;
  try {
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    const score = json.score === "HOT" || json.score === "WARM" || json.score === "COLD" ? json.score : "COLD";
    const value = Math.max(0, Math.min(100, Number(json.value) || 0));
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 6) : [];
    return {
      score,
      value,
      whyShort: String(json.whyShort ?? "").slice(0, 240),
      buyingSignals: arr(json.buyingSignals),
      risks: arr(json.risks),
      nextAction: String(json.nextAction ?? "").slice(0, 240),
    };
  } catch (e) {
    console.warn("aiScoreLead JSON parse failed:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation-grounded summary  (NEW — fixes Lalit's "Next Step and whatsapp
// draft are senseless, They should be according to client real call
// conversations, not anytime on its own")
//
// Takes the lead + its full call history + remarks and returns a fresh
// summary + next-best-action that's grounded in what was actually said on
// recent calls. Called fire-and-forget from log-call/route.ts after every
// new CallLog so the data always reflects reality.
// ─────────────────────────────────────────────────────────────────────────────

export interface CallForAI {
  startedAt: Date;
  outcome: string;
  durationSec?: number | null;
  notes?: string | null;
  attributedAgentName?: string | null;
}

export interface ConversationSummary {
  summary: string;
  nextAction: string;
}

export async function generateConversationSummary(
  lead: Pick<LeadForAI, "name" | "company" | "city" | "configuration" | "budgetMin" | "budgetCurrency" | "whoIsClient" | "categorization" | "fundReadiness" | "whenCanInvest" | "status" | "remarks">,
  callLogs: CallForAI[],
): Promise<ConversationSummary | null> {
  if (!aiEnabled()) return null;

  // Newest-first up to 10 most recent calls — enough context, bounded size.
  const recent = callLogs.slice(0, 10);
  const callLines = recent.map((c, i) => {
    const who = c.attributedAgentName ?? "Agent";
    const when = c.startedAt.toISOString().slice(0, 10);
    const dur = c.durationSec ? ` (${Math.round(c.durationSec / 60)} min)` : "";
    return `${i + 1}. ${when} · ${who} · ${c.outcome.replaceAll("_", " ")}${dur}\n   ${c.notes ?? "(no notes)"}`;
  }).join("\n");

  const prompt = `You are a senior sales coach reviewing a real-estate lead's call history. Produce a concise UPDATE based ONLY on what was discussed in the recent calls below. Do NOT speculate or use generic phrases like "follow up" without specifics.

Reply STRICTLY as JSON: {"summary":"2-3 sentences capturing where the conversation actually is","nextAction":"1 sentence with a specific action grounded in the latest call"}.

If there is no useful signal in the call history (e.g. only "not picked" entries), say so plainly in the summary and recommend trying a different time slot / channel in nextAction.

LEAD: ${lead.name}${lead.company ? ` · ${lead.company}` : ""}${lead.city ? ` · ${lead.city}` : ""}
Looking for: ${lead.configuration ?? "?"} · Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"}
Stage: ${lead.status} · Categorization: ${lead.categorization ?? "—"}
Fund: ${lead.fundReadiness ?? "—"} · Timeline: ${lead.whenCanInvest ?? "—"}

${lead.whoIsClient ? `Who is the client:\n${lead.whoIsClient}\n` : ""}
Recent calls (newest first):
${callLines || "(no calls yet)"}

Original remarks from MIS sheet (truncated):
${(lead.remarks ?? "").slice(0, 1500)}`;

  const text = await generateText({ prompt, maxTokens: 350 });
  if (!text) return null;
  try {
    const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? text);
    const summary = String(json.summary ?? "").trim();
    const nextAction = String(json.nextAction ?? "").trim();
    if (!summary && !nextAction) return null;
    return { summary, nextAction };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask-the-CRM chat (existing API)
// ─────────────────────────────────────────────────────────────────────────────

export async function askCRM(question: string, contextSummary: string): Promise<string> {
  if (!aiEnabled()) {
    return `🤖 (AI not configured yet)\n\nI'd answer "${question}" if you set GEMINI_API_KEY (free) in your environment.\n\nHere's the raw CRM context I would have used:\n\n${contextSummary}`;
  }
  const text = await generateText({
    system: "You are an AI assistant inside White Collar Realty's Dubai-focused CRM. Answer the sales manager's question concisely using the provided CRM context. Currency is AED. When evaluating leads, prioritise the 'Who Is Client' narrative and the qualification fields (Potential, Fund Readiness, When Can Invest, Mood). Avoid keyword-pattern summaries — explain the situation. Use bullet points for lists.",
    prompt: `CRM context:\n${contextSummary}\n\nQuestion: ${question}`,
    maxTokens: 800,
  });
  return text ?? "AI request failed. Try again or check the server logs.";
}

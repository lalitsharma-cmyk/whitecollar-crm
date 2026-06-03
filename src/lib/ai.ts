import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getAiEnabled, getAiTrialModeEnabled, getAiMonthlyCostCapUsd } from "@/lib/settings";

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

// Truthful "is real AI live right now" — provider configured AND the admin
// kill-switch (Setting "ai.enabled") is ON. Async (reads the DB flag). Use this
// for UI badges + "AI disabled by admin" messaging; aiEnabled() alone only means
// a provider key is present, not that the admin has turned AI on.
export async function aiLive(): Promise<boolean> {
  if (aiProvider() === null) return false;
  return getAiEnabled();
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost model (approximate 2026 list prices, USD per 1,000,000 tokens). Kept
// conservative so a pre-run ESTIMATE never under-promises. Gemini's free tier
// bills ₹0 in practice — these are the paid-tier list prices, shown so an
// estimate is never misleadingly zero; the trial report flags free-tier runs.
// Handy identity: USD-per-1M-tokens == micro-USD-per-token, so cost in micro-USD
// = inTok * inPerM + outTok * outPerM.
// ─────────────────────────────────────────────────────────────────────────────
export interface ModelPrice { inPerM: number; outPerM: number }
export const AI_PRICES: Record<string, ModelPrice> = {
  "gemini-1.5-flash": { inPerM: 0.075, outPerM: 0.30 },
  "gemini-2.0-flash": { inPerM: 0.10, outPerM: 0.40 },
  "gemini-2.5-flash": { inPerM: 0.15, outPerM: 0.60 },
  "gemini-1.5-pro": { inPerM: 1.25, outPerM: 5.00 },
  "claude-haiku-4-5": { inPerM: 1.00, outPerM: 5.00 },
};
const DEFAULT_PRICE: ModelPrice = { inPerM: 1.0, outPerM: 5.0 };

/** Cost of a call in MICRO-USD (1e-6 USD), rounded. Unknown model → safe default. */
export function costMicroUsd(model: string | null | undefined, inTok: number, outTok: number): number {
  const p = (model && AI_PRICES[model]) || DEFAULT_PRICE;
  return Math.round(inTok * p.inPerM + outTok * p.outPerM);
}

/** The model id that WOULD be used for the active provider (for estimates / display). */
export function activeModel(): string | null {
  const p = aiProvider();
  if (p === "gemini") return GEMINI_MODEL;
  if (p === "anthropic") return ANTHROPIC_MODEL;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation core. ALL provider HTTP traffic funnels through generateTextWithUsage,
// which makes it the single enforcement point for:
//   • the admin KILL-SWITCH (Setting "ai.enabled") — when OFF, normal calls
//     return null at ZERO cost and callers fall back to the rule-based path;
//   • TRIAL MODE — a confirmed trial (ctx.trial) may run under
//     "ai.trialMode.enabled" even while global AI is OFF;
//   • token + cost capture and the AiUsageLog audit row.
// Cost is therefore incurred ONLY when a request is actually sent from here —
// never on page load, list render, or a cached-value display.
// ─────────────────────────────────────────────────────────────────────────────
interface GenArgs {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface GenContext {
  feature?: string;            // logical tag for AiUsageLog: "score" | "summary" | "chat" | "trial" | …
  leadId?: string | null;
  trialRunId?: string | null;
  trial?: boolean;             // confirmed trial → allowed under ai.trialMode.enabled while global AI is OFF
  log?: boolean;               // write an AiUsageLog row (default true)
}

export interface GenResult {
  text: string | null;
  inputTokens: number;
  outputTokens: number;
  provider: Provider;
  model: string | null;
  state: "ok" | "disabled" | "no_provider" | "error";
}

const emptyGen = (state: GenResult["state"], provider: Provider = null, model: string | null = null): GenResult =>
  ({ text: null, inputTokens: 0, outputTokens: 0, provider, model, state });

/**
 * Full-fidelity generation: text + token usage + provider/model + a machine
 * state. Use when you need cost/usage (e.g. the AI trial engine). Enforces the
 * kill-switch and writes the AiUsageLog row.
 */
export async function generateTextWithUsage(
  { system, prompt, maxTokens = 600 }: GenArgs,
  ctx: GenContext = {},
): Promise<GenResult> {
  const provider = aiProvider();
  if (!provider) return emptyGen("no_provider");

  // KILL-SWITCH. Normal calls require global ai.enabled. A confirmed trial may
  // proceed under ai.trialMode.enabled even while global AI is off.
  const globalOn = await getAiEnabled();
  const allowed = globalOn || (ctx.trial === true && (await getAiTrialModeEnabled()));
  if (!allowed) return emptyGen("disabled", provider);

  // MONTHLY COST-CAP CHECK. Skip if cap is 0 (disabled) or not set.
  const capUsd = await getAiMonthlyCostCapUsd();
  if (capUsd > 0) {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const spent = await prisma.aiUsageLog.aggregate({
      _sum: { costMicroUsd: true },
      where: { createdAt: { gte: monthStart } },
    });
    const spentMicroUsd = spent._sum.costMicroUsd ?? 0;
    const spentUsd = spentMicroUsd / 1_000_000;
    if (spentUsd >= capUsd) {
      console.warn(`AI monthly cost cap reached: $${spentUsd.toFixed(4)} >= $${capUsd}`);
      return emptyGen("disabled", provider);
    }
  }

  const model = provider === "gemini" ? GEMINI_MODEL : ANTHROPIC_MODEL;
  const startedAt = Date.now();
  let out: { text: string | null; inputTokens: number; outputTokens: number };
  try {
    out =
      provider === "gemini"
        ? await geminiGenerate({ system, prompt, maxTokens })
        : await anthropicGenerate({ system, prompt, maxTokens });
  } catch (e) {
    console.error("AI generate failed", e);
    await logUsage({ provider, model, ctx, inTok: 0, outTok: 0, ms: Date.now() - startedAt, ok: false });
    return emptyGen("error", provider, model);
  }
  const ms = Date.now() - startedAt;
  await logUsage({ provider, model, ctx, inTok: out.inputTokens, outTok: out.outputTokens, ms, ok: out.text != null });
  return {
    text: out.text,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    provider,
    model,
    state: out.text != null ? "ok" : "error",
  };
}

// Best-effort usage audit. NEVER throws into the caller — a logging failure must
// not break an AI feature or abort a trial run.
async function logUsage(args: {
  provider: Provider; model: string; ctx: GenContext; inTok: number; outTok: number; ms: number; ok: boolean;
}): Promise<void> {
  if (args.ctx.log === false) return;
  if (!args.provider) return;
  try {
    await prisma.aiUsageLog.create({
      data: {
        provider: args.provider,
        model: args.model,
        feature: args.ctx.feature ?? null,
        leadId: args.ctx.leadId ?? null,
        trialRunId: args.ctx.trialRunId ?? null,
        inputTokens: args.inTok,
        outputTokens: args.outTok,
        costMicroUsd: costMicroUsd(args.model, args.inTok, args.outTok),
        ms: args.ms,
        ok: args.ok,
      },
    });
  } catch (e) {
    console.warn("AiUsageLog write failed (non-fatal):", e);
  }
}

/**
 * Back-compat convenience: text only. Honors the same kill-switch + trial gate.
 * Existing callers keep working unchanged; pass ctx to tag usage by feature or
 * to run under a confirmed trial.
 */
export async function generateText(args: GenArgs, ctx: GenContext = {}): Promise<string | null> {
  return (await generateTextWithUsage(args, ctx)).text;
}

async function geminiGenerate({ system, prompt, maxTokens }: Required<Pick<GenArgs, "prompt" | "maxTokens">> & { system?: string }): Promise<{ text: string | null; inputTokens: number; outputTokens: number }> {
  const key = process.env.GEMINI_API_KEY!;
  // Gemini's REST API. Raw fetch keeps us free of @google/generative-ai as a
  // dependency. System instruction goes in a dedicated field on v1beta. A
  // network throw propagates to generateTextWithUsage's try/catch.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }),
  });
  if (!r.ok) {
    const errBody = await r.text();
    console.error("Gemini error", r.status, errBody.slice(0, 200));
    return { text: null, inputTokens: 0, outputTokens: 0 };
  }
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const u = j.usageMetadata ?? {};
  return {
    text: text || null,
    inputTokens: Number(u.promptTokenCount) || 0,
    outputTokens: Number(u.candidatesTokenCount) || 0,
  };
}

async function anthropicGenerate({ system, prompt, maxTokens }: Required<Pick<GenArgs, "prompt" | "maxTokens">> & { system?: string }): Promise<{ text: string | null; inputTokens: number; outputTokens: number }> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const client = new Anthropic({ apiKey: key });
  const msg = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return {
    text: text || null,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
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

export async function scoreLead(lead: LeadForAI, ctx: GenContext = {}): Promise<AIScoreResult> {
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

  const text = await generateText({ prompt, maxTokens: 400 }, { feature: "score", ...ctx });
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

export async function aiScoreLead(input: AIScoreLeadInput, ctx: GenContext = {}): Promise<AIScoreLeadResult | null> {
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

  const text = await generateText({ prompt, maxTokens: 500 }, { feature: "score", leadId: input.leadId, ...ctx });
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
  ctx: GenContext = {},
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

  const text = await generateText({ prompt, maxTokens: 350 }, { feature: "summary", ...ctx });
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

export async function askCRM(question: string, contextSummary: string, ctx: GenContext = {}): Promise<string> {
  if (!aiEnabled()) {
    return `🤖 (AI not configured yet)\n\nI'd answer "${question}" if you set GEMINI_API_KEY (free) in your environment.\n\nHere's the raw CRM context I would have used:\n\n${contextSummary}`;
  }
  const text = await generateText({
    system: "You are an AI assistant inside White Collar Realty's Dubai-focused CRM. Answer the sales manager's question concisely using the provided CRM context. Currency is AED. When evaluating leads, prioritise the 'Who Is Client' narrative and the qualification fields (Potential, Fund Readiness, When Can Invest, Mood). Avoid keyword-pattern summaries — explain the situation. Use bullet points for lists.",
    prompt: `CRM context:\n${contextSummary}\n\nQuestion: ${question}`,
    maxTokens: 800,
  }, { feature: "chat", ...ctx });
  return text ?? "AI request failed. Try again or check the server logs.";
}

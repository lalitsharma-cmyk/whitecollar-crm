import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key.trim() === "") return null;
  return new Anthropic({ apiKey: key });
}

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== "");
}

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
  // DEPTH — Lalit's priority
  whoIsClient?: string | null;
  potential?: string | null;
  fundReadiness?: string | null;
  whenCanInvest?: string | null;
  moodStatus?: string | null;
  categorization?: string | null;
  remarks?: string | null;
  // signals
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
  const client = getClient();
  if (!client) return ruleBasedScore(lead);

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

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
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
  // Depth field is the strongest signal
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
    summary: `Rule-based (no AI key set): ${bucket.toLowerCase()} lead, ${lead.fundReadiness ?? "fund readiness unknown"}, ${lead.whenCanInvest ?? "timeline unknown"}. Set ANTHROPIC_API_KEY in .env for narrative-aware AI scoring that reads "Who Is Client".`,
    nextAction: bucket === "HOT" ? (lead.todoNext ?? "Call now and propose a site visit this week.") : bucket === "WARM" ? "Send a personalised WhatsApp follow-up referencing their stated need." : "Add to nurture drip; revisit in 30 days.",
  };
}

export async function askCRM(question: string, contextSummary: string): Promise<string> {
  const client = getClient();
  if (!client) {
    return `🤖 (AI not configured yet)\n\nI'd answer "${question}" if you set ANTHROPIC_API_KEY in your environment.\n\nHere's the raw CRM context I would have used:\n\n${contextSummary}`;
  }
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: "You are an AI assistant inside White Collar Realty's Dubai-focused CRM. Answer the sales manager's question concisely using the provided CRM context. Currency is AED. When evaluating leads, prioritise the 'Who Is Client' narrative and the qualification fields (Potential, Fund Readiness, When Can Invest, Mood). Avoid keyword-pattern summaries — explain the situation. Use bullet points for lists.",
    messages: [{ role: "user", content: `CRM context:\n${contextSummary}\n\nQuestion: ${question}` }],
  });
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

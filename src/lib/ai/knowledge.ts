// AI Sales OS — Knowledge base + retrieval (M6), PURE + unit-testable. A small,
// curated set of WCR sales-knowledge entries the Reason layer can retrieve to GROUND a
// suggestion (so advice cites a known rule, not a hallucination). Retrieval is
// deterministic keyword/tag overlap — no embeddings, no LLM, no external call. When the
// Gemini engine lands (M7) it consumes these entries as grounding context; until then
// the rule engine can attach them to suggestions directly.
//
// Entries encode the CRM's OWN established rules (market/currency segregation, fresh-lead
// SLA, follow-up discipline, returning-client check) — safe, grounded facts.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
export type KbMarket = "India" | "UAE" | "both";

export interface KnowledgeEntry {
  id: string;
  topic: string;      // short human title
  body: string;       // the guidance (one or two sentences)
  tags: string[];     // lowercase retrieval keywords
  market: KbMarket;
}

export const KNOWLEDGE_BASE: KnowledgeEntry[] = [
  {
    id: "kb.market.segregation",
    topic: "Market & currency never mix",
    body: "India deals are in INR, Dubai/UAE deals in AED — never convert or mix. Match a buyer only to a property in the SAME market.",
    tags: ["market", "currency", "inr", "aed", "india", "uae", "dubai", "segregation", "match"],
    market: "both",
  },
  {
    id: "kb.sla.fresh",
    topic: "Fresh-lead 15-minute SLA",
    body: "A newly assigned lead should get its first call within 15 minutes. Fresh, uncontacted leads are the highest-priority queue.",
    tags: ["fresh", "sla", "first call", "new lead", "uncontacted", "hot", "response time"],
    market: "both",
  },
  {
    id: "kb.followup.discipline",
    topic: "Follow-up discipline",
    body: "Every workable lead needs a future follow-up date. Overdue follow-ups decay conversion — clear them before starting new outreach.",
    tags: ["followup", "follow-up", "overdue", "reschedule", "pipeline", "discipline"],
    market: "both",
  },
  {
    id: "kb.returning.client",
    topic: "Check for a returning client",
    body: "Before working a new enquiry, check the unified customer profile — a returning client's prior budget, projects and history should inform the pitch.",
    tags: ["returning", "customer", "unified", "profile", "history", "repeat", "identity"],
    market: "both",
  },
  {
    id: "kb.objection.budget",
    topic: "Budget objection",
    body: "When budget is the blocker, requalify: confirm the real range, offer options in-band, and note payment-plan flexibility rather than discounting immediately.",
    tags: ["objection", "budget", "price", "expensive", "payment plan", "qualify", "bant"],
    market: "both",
  },
  {
    id: "kb.stalled.revival",
    topic: "Reviving a stalled lead",
    body: "For a lead with no recent activity, lead with new information (price change, new inventory, launch) rather than a generic check-in.",
    tags: ["stalled", "revival", "cold", "re-engage", "dormant", "no activity", "nudge"],
    market: "both",
  },
];

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

/** Deterministic retrieval: score entries by query-term overlap against tags (weight 2)
 *  + topic/body terms (weight 1). Market-filtered (a market query excludes the other
 *  market; "both" always eligible). Returns highest-scoring first, score > 0 only. */
export function retrieveKnowledge(
  query: string,
  opts: { market?: "India" | "UAE"; limit?: number } = {},
  kb: KnowledgeEntry[] = KNOWLEDGE_BASE,
): Array<{ entry: KnowledgeEntry; score: number }> {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];

  const scored = kb
    .filter((e) => !opts.market || e.market === "both" || e.market === opts.market)
    .map((e) => {
      const tagTerms = new Set(e.tags.flatMap(tokenize));
      const textTerms = new Set(tokenize(`${e.topic} ${e.body}`));
      let score = 0;
      for (const t of terms) {
        if (tagTerms.has(t)) score += 2;
        else if (textTerms.has(t)) score += 1;
      }
      return { entry: e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return typeof opts.limit === "number" ? scored.slice(0, opts.limit) : scored;
}

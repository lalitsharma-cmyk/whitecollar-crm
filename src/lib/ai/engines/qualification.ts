import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../runEngine";
import { WCR_PERSONA, leadBlock } from "../persona";

/**
 * Qualification Engine — 9-dimension lead qualification.
 * Goes beyond BANT: adds Intent, Portfolio, Investment Knowledge, Visit Status,
 * and Engagement so a lead is scored the way Lalit would size it up on a call.
 */

export type Signal = "Strong" | "Moderate" | "Weak" | "Unknown";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface QualificationDimension {
  score: number; // 0–10
  signal: Signal;
  evidence: string; // what in the data supports this
  gap: string | null; // what's missing to raise it
  confidence: Confidence;
}

export const QUAL_DIMENSIONS = [
  "budget",
  "authority",
  "need",
  "timeline",
  "intent",
  "portfolio",
  "investmentKnowledge",
  "visitStatus",
  "engagement",
] as const;
export type QualDimensionKey = (typeof QUAL_DIMENSIONS)[number];

export interface QualificationResult {
  overall: "Qualified" | "PartiallyQualified" | "Unqualified";
  totalScore: number; // 0–100
  summary: string;
  dimensions: Record<QualDimensionKey, QualificationDimension>;
  biggestGap: string;
  nextQuestionToAsk: string;
}

const DIMENSION_LABELS: Record<QualDimensionKey, string> = {
  budget: "Budget",
  authority: "Authority / decision-maker",
  need: "Need / motivation",
  timeline: "Timeline / urgency",
  intent: "Buying intent",
  portfolio: "Existing portfolio",
  investmentKnowledge: "Investment knowledge",
  visitStatus: "Visit / meeting progress",
  engagement: "Engagement / responsiveness",
};

// ─── Deterministic mock (lead-aware) ─────────────────────────────────────────────

function hashish(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function mockDim(present: boolean, seed: number, evidencePresent: string, gapAbsent: string): QualificationDimension {
  if (present) {
    const score = 6 + (seed % 4); // 6–9
    return { score, signal: score >= 8 ? "Strong" : "Moderate", evidence: evidencePresent, gap: null, confidence: "MEDIUM" };
  }
  return { score: seed % 3, signal: seed % 3 === 0 ? "Unknown" : "Weak", evidence: "Not established in the conversation yet.", gap: gapAbsent, confidence: "LOW" };
}

function mock(ctx: EngineContext): QualificationResult {
  const l = ctx.lead;
  const seed = hashish(l.id || l.name);
  const hasBudget = !!(l.budget || l.bant?.budget);
  const hasAuthority = !!l.bant?.authority;
  const hasNeed = !!(l.requirement || l.bant?.need);
  const hasTimeline = !!l.bant?.timeline;
  const hasVisit = (l.siteVisitsCount ?? 0) > 0 || (l.meetingsCount ?? 0) > 0;
  const engaged = (l.lastContactDays ?? 99) <= 14;
  const remarkLen = (l.remarks ?? "").length;
  const hasIntent = remarkLen > 120;
  const hasPortfolio = /portfolio|own|already (have|bought)|invest/i.test(l.remarks ?? "");
  const hasKnowledge = /roi|payment plan|off-plan|handover|golden visa|yield/i.test(l.remarks ?? "");

  const dimensions: Record<QualDimensionKey, QualificationDimension> = {
    budget: mockDim(hasBudget, seed, `Budget signal on file: ${l.budget ?? l.bant?.budget}.`, "No budget range confirmed — ask their target ticket size in AED."),
    authority: mockDim(hasAuthority, seed >> 1, `Decision-making noted: ${l.bant?.authority}.`, "Decision-maker unclear — confirm if spouse/partner is involved."),
    need: mockDim(hasNeed, seed >> 2, `Requirement captured: ${l.requirement ?? l.bant?.need}.`, "Purpose (end-use vs investment) not established."),
    timeline: mockDim(hasTimeline, seed >> 3, `Timeline indicated: ${l.bant?.timeline}.`, "No purchase timeframe — ask when they intend to transact."),
    intent: mockDim(hasIntent, seed >> 4, "Sustained two-way conversation indicates genuine interest.", "Thin conversation — intent not yet demonstrated."),
    portfolio: mockDim(hasPortfolio, seed >> 5, "Client references existing holdings / investment background.", "Unknown whether they already own Dubai property."),
    investmentKnowledge: mockDim(hasKnowledge, seed >> 6, "Uses investor vocabulary (ROI / payment plan / handover).", "Knowledge level untested — gauge familiarity with off-plan."),
    visitStatus: mockDim(hasVisit, seed >> 7, `${l.meetingsCount ?? 0} meeting(s), ${l.siteVisitsCount ?? 0} site visit(s) logged.`, "No meeting or site visit yet — the deal hasn't been anchored."),
    engagement: mockDim(engaged, seed >> 8, `Contacted within ${l.lastContactDays} day(s) — warm.`, "Gone quiet — re-engagement needed before qualifying further."),
  };

  const total = Math.round(
    (QUAL_DIMENSIONS.reduce((sum, k) => sum + dimensions[k].score, 0) / (QUAL_DIMENSIONS.length * 10)) * 100,
  );
  const overall = total >= 70 ? "Qualified" : total >= 40 ? "PartiallyQualified" : "Unqualified";
  const weakest = QUAL_DIMENSIONS.reduce((a, b) => (dimensions[a].score <= dimensions[b].score ? a : b));

  return {
    overall,
    totalScore: total,
    summary: `${l.name} scores ${total}/100 (${overall}). Strongest where data exists; the deal is held back by ${DIMENSION_LABELS[weakest].toLowerCase()}.`,
    dimensions,
    biggestGap: dimensions[weakest].gap ?? `Deepen ${DIMENSION_LABELS[weakest]}.`,
    nextQuestionToAsk:
      weakest === "budget" ? "What ticket size in AED are you comfortable deploying for this investment?" :
      weakest === "timeline" ? "Are you looking to close in the next 30–60 days, or exploring for later this year?" :
      weakest === "authority" ? "Will this be your decision alone, or jointly with family/partners?" :
      weakest === "visitStatus" ? "Can we lock a site visit / video walkthrough this week?" :
      "What's the one thing that would make you comfortable moving ahead?",
  };
}

// ─── Real-provider prompt + parse ────────────────────────────────────────────────

const SCHEMA_HINT = `Return JSON with this exact shape:
{
  "overall": "Qualified" | "PartiallyQualified" | "Unqualified",
  "totalScore": number 0-100,
  "summary": string,
  "dimensions": {
    "budget" | "authority" | "need" | "timeline" | "intent" | "portfolio" | "investmentKnowledge" | "visitStatus" | "engagement": {
      "score": number 0-10,
      "signal": "Strong" | "Moderate" | "Weak" | "Unknown",
      "evidence": string,
      "gap": string | null,
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
  },
  "biggestGap": string,
  "nextQuestionToAsk": string
}
All nine dimension keys are REQUIRED.`;

export const qualificationEngine: Engine<QualificationResult> = {
  key: "qualification",
  title: "Qualification Engine",
  description: "9-dimension qualification: BANT + Intent, Portfolio, Investment Knowledge, Visit Status, Engagement.",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nTask: Qualify this lead across nine dimensions and decide if it is Qualified, Partially Qualified, or Unqualified.\n${SCHEMA_HINT}`,
      user: `Qualify this lead. Score each dimension 0-10 with evidence and the gap to raise it.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<QualificationResult>(raw);
    if (!r.dimensions || typeof r.totalScore !== "number") throw new Error("missing required fields");
    for (const k of QUAL_DIMENSIONS) {
      if (!r.dimensions[k]) throw new Error(`missing dimension: ${k}`);
    }
    return r;
  },
};

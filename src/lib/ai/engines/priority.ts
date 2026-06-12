import type { Engine, EngineContext } from "../types";
import { parseJsonLoose } from "../json";
import { WCR_PERSONA, leadBlock } from "../persona";
import { parseBudgetAed } from "./util";

/**
 * Priority Ranking Engine — answers "of all my active leads, how hard should I
 * work THIS one today?" via a comparable 0–100 score. The cross-lead ordering
 * (top-5 today) is an aggregate view built over many of these scores; here we
 * compute the per-lead score + the factors behind it.
 */

export type PriorityTier = "WorkFirst" | "WorkToday" | "ThisWeek" | "Backlog";

export interface PriorityFactors {
  closureProbability: number; // 0–100
  dealSize: number; // 0–100
  urgency: number; // 0–100
  responseQuality: number; // 0–100
  decisionMakerAccess: number; // 0–100
}

export interface PriorityResult {
  priorityScore: number; // 0–100
  tier: PriorityTier;
  factors: PriorityFactors;
  reasoning: string;
  rankHint: string;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function mock(ctx: EngineContext): PriorityResult {
  const l = ctx.lead;
  const budget = parseBudgetAed(l.budget ?? l.bant?.budget);
  const days = l.lastContactDays ?? 999;
  const acts = l.recentActivities?.length ?? 0;

  const dealSize = clamp(budget >= 10_000_000 ? 100 : budget >= 5_000_000 ? 85 : budget >= 2_000_000 ? 65 : budget > 0 ? 45 : 20);
  const closureProbability = clamp(
    (l.bant?.budget ? 25 : 0) + (l.bant?.need ? 20 : 0) + (l.bant?.timeline ? 25 : 0) + (l.bant?.authority ? 15 : 0) + ((l.siteVisitsCount ?? 0) + (l.meetingsCount ?? 0) > 0 ? 15 : 0),
  );
  const urgency = clamp(l.bant?.timeline ? 80 : days <= 7 ? 60 : days <= 30 ? 40 : 20);
  const responseQuality = clamp(acts >= 5 ? 85 : acts >= 2 ? 60 : acts === 1 ? 35 : 10);
  const decisionMakerAccess = clamp(l.bant?.authority ? 80 : 25);

  const factors: PriorityFactors = { closureProbability, dealSize, urgency, responseQuality, decisionMakerAccess };

  // Weighted: probability and deal size dominate, then urgency.
  const priorityScore = clamp(
    closureProbability * 0.3 + dealSize * 0.28 + urgency * 0.22 + responseQuality * 0.1 + decisionMakerAccess * 0.1,
  );
  const tier: PriorityTier = priorityScore >= 75 ? "WorkFirst" : priorityScore >= 55 ? "WorkToday" : priorityScore >= 35 ? "ThisWeek" : "Backlog";

  const lead2 = dealSize >= 85 ? "high deal value" : closureProbability >= 60 ? "strong closing signals" : urgency >= 70 ? "time pressure" : "moderate signals";

  return {
    priorityScore,
    tier,
    factors,
    reasoning: `Driven by ${lead2}. Closure ${closureProbability}, deal size ${dealSize}, urgency ${urgency}. ${
      tier === "WorkFirst" ? "Belongs in today's top handful." : tier === "Backlog" ? "Low return on effort right now — nurture, don't chase." : "Solid mid-priority; advance the gaps."
    }`,
    rankHint:
      tier === "WorkFirst" ? "If you have 100 leads, this is a top-5-today candidate."
      : tier === "WorkToday" ? "Work it today, after the top tier."
      : tier === "ThisWeek" ? "Schedule within the week."
      : "Park on the nurture list; revisit on a trigger.",
  };
}

const SCHEMA_HINT = `Return ONLY JSON: { "priorityScore":number 0-100, "tier":"WorkFirst"|"WorkToday"|"ThisWeek"|"Backlog", "factors":{ "closureProbability":number, "dealSize":number, "urgency":number, "responseQuality":number, "decisionMakerAccess":number }, "reasoning":string, "rankHint":string }`;

export const priorityEngine: Engine<PriorityResult> = {
  key: "priority",
  title: "Priority Ranking",
  description: "Scores how hard to work this lead vs all others today (probability × deal size × urgency × access).",
  buildPrompt(ctx) {
    return {
      system: `${WCR_PERSONA}\n\nScore how hard the agent should work THIS lead today versus all their other active leads. Factor closure probability, deal size, urgency, response quality, decision-maker access.\n${SCHEMA_HINT}`,
      user: `Score this lead's work-priority.\n\n${leadBlock(ctx.lead)}`,
    };
  },
  mock,
  parse(raw) {
    const r = parseJsonLoose<PriorityResult>(raw);
    if (typeof r.priorityScore !== "number" || !r.factors) throw new Error("missing required priority fields");
    return r;
  },
};

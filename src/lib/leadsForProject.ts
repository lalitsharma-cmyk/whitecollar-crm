// Reverse-inventory matching — given a project, surface ACTIVE-pipeline leads
// whose stated preferences make them worth pitching this project to.
//
// This is the inverse of bestUnitsForLead() in ./inventoryMatch.ts. We mirror
// its budget/team-geography filtering, but the scoring constants here are
// project-side specific (per spec §9.8) and are intentionally NOT shared from
// inventoryMatch.ts — the lead→unit scorer uses a different weighting (config
// match, price-fit curve) that doesn't apply when we don't have a single unit
// to compare against. Comment block kept inline so future devs don't try to
// DRY this with the wrong helper.
//
// Scoring (per spec §9.8):
//   • budget overlap (lead.budgetMin within ±30% of project's median unit
//     priceBase)                            → +50
//   • aiScore == HOT                        → +20
//   • aiScore == WARM                       → +10
//   • lead.city matches project.city/area   → +15
//
// Filtering (BEFORE scoring):
//   • lead.status IN (NEW, CONTACTED, QUALIFIED, SITE_VISIT, NEGOTIATION)
//   • team match: project.country "India" → lead.forwardedTeam "India";
//                 project.country "UAE"/"Dubai" → lead.forwardedTeam "Dubai"
//   • lead.budgetMin present (>0) — we skip leads with no stated budget
//   • not already attached to any unit of this project via LeadProperty
//     (avoid double-pitching the same prospect)

import { prisma } from "@/lib/prisma";
import { LeadStatus, AIScore } from "@prisma/client";

export type SuggestedLead = {
  leadId: string;
  leadName: string;
  budget: number;
  currency: string;
  aiScore: AIScore | null;
  score: number;
};

const ACTIVE_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.QUALIFIED,
  LeadStatus.SITE_VISIT,
  LeadStatus.NEGOTIATION,
];

// Score weights — see header comment for spec reference.
const SCORE_BUDGET_MATCH = 50;
const SCORE_HOT = 20;
const SCORE_WARM = 10;
const SCORE_CITY_MATCH = 15;

// Lead.forwardedTeam value that should be matched against this project.
function teamForCountry(country?: string | null): string | null {
  if (!country) return null;
  const c = country.toLowerCase();
  if (c === "india") return "India";
  if (c === "uae" || c === "united arab emirates" || c === "dubai") return "Dubai";
  return null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normaliseCity(s?: string | null): string {
  return (s ?? "").toLowerCase().trim();
}

export async function bestLeadsForProject(
  projectId: string,
  limit = 5,
): Promise<SuggestedLead[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      city: true,
      area: true,
      country: true,
      units: { select: { id: true, priceBase: true } },
    },
  });
  if (!project) return [];

  const team = teamForCountry(project.country);
  if (!team) return [];

  const prices = project.units.map((u) => u.priceBase).filter((p) => p > 0);
  if (prices.length === 0) return [];
  const medianPrice = median(prices);
  if (medianPrice <= 0) return [];

  // ±30% budget band around the project's median unit price.
  const lo = medianPrice * 0.7;
  const hi = medianPrice * 1.3;

  // Exclude leads already attached to any unit in this project — avoid
  // double-pitching a prospect we're already working on the same project with.
  const unitIds = project.units.map((u) => u.id);
  const alreadyAttached = unitIds.length
    ? await prisma.leadProperty.findMany({
        where: { unitId: { in: unitIds } },
        select: { leadId: true },
      })
    : [];
  const excludeLeadIds = [...new Set(alreadyAttached.map((lp) => lp.leadId))];

  // Pre-filter at DB layer: active pipeline + correct team + budget present
  // and within ±30%. Over-fetch a small pool so AI-score / city tiebreakers
  // have something to rank from.
  const candidatePool = Math.min(Math.max(limit * 8, 24), 200);
  const leads = await prisma.lead.findMany({
    where: {
      status: { in: ACTIVE_STATUSES },
      forwardedTeam: team,
      budgetMin: { gte: lo, lte: hi },
      ...(excludeLeadIds.length ? { id: { notIn: excludeLeadIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      budgetMin: true,
      budgetCurrency: true,
      aiScore: true,
      city: true,
    },
    take: candidatePool,
    orderBy: { lastTouchedAt: "desc" },
  });
  if (leads.length === 0) return [];

  const projectCity = normaliseCity(project.city);
  const projectArea = normaliseCity(project.area);

  const scored: SuggestedLead[] = leads.map((l) => {
    let score = 0;
    // Budget match — by construction every candidate is in the ±30% band,
    // so award the full budget bonus.
    if (l.budgetMin && l.budgetMin > 0) score += SCORE_BUDGET_MATCH;
    if (l.aiScore === AIScore.HOT) score += SCORE_HOT;
    else if (l.aiScore === AIScore.WARM) score += SCORE_WARM;
    const leadCity = normaliseCity(l.city);
    if (
      leadCity &&
      (leadCity === projectCity ||
        (projectArea && leadCity === projectArea))
    ) {
      score += SCORE_CITY_MATCH;
    }
    return {
      leadId: l.id,
      leadName: l.name,
      budget: l.budgetMin ?? 0,
      currency: l.budgetCurrency,
      aiScore: l.aiScore,
      score,
    };
  });

  // Highest score first; ties broken by larger budget (bigger ticket = better
  // deal to pursue first).
  scored.sort((a, b) => (b.score - a.score) || (b.budget - a.budget));

  return scored.slice(0, limit);
}

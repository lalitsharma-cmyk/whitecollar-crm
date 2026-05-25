// Inventory matching — pick the top-N AVAILABLE units that best fit a lead's
// budget, configuration, and team geography.
//
// Scoring rules (per spec):
//   • configuration exact match    → +10
//   • configuration partial match  → +5   (e.g. "1BR" vs "1BHK", "2BHK" vs "2-bedroom")
//   • configuration no match       → -5
//   • price within ±20% of budget  → bonus inversely proportional to distance
//   • carpet area / floor / view   → small tiebreakers when present
//
// Filtering (BEFORE scoring):
//   • unit.status        = AVAILABLE
//   • project.country    matches lead.forwardedTeam (Dubai → UAE, India → India)
//   • unit.priceBase     within ±20% of lead.budgetMin
//
// If the lead has no budgetMin or forwardedTeam, returns []. We don't guess.
//
// Returned shape is the Unit row with its Project relation eagerly included +
// the computed score, so callers can render project name / heroColor / etc.
// without a second round-trip.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export type SuggestedUnit = Prisma.UnitGetPayload<{ include: { project: true } }> & {
  score: number;
};

/** Map Dubai/India team label → Project.country value. Anything else → null (no match). */
function countryForTeam(team?: string | null): string | null {
  if (!team) return null;
  const t = team.toLowerCase();
  if (t === "dubai" || t === "uae") return "UAE";
  if (t === "india") return "India";
  return null;
}

/**
 * Normalise a configuration string for comparison:
 *   "2 BHK"   → "2bhk"
 *   "2-BR"    → "2br"
 *   "Villa"   → "villa"
 *   "3 Bedroom" → "3bedroom"
 * Strips whitespace/dashes/dots and lowercases.
 */
function normaliseConfig(s?: string | null): string {
  return (s ?? "").toLowerCase().replace(/[\s\-_.]/g, "").trim();
}

/**
 * Extract the bedroom count from a config like "2BR" / "3BHK" / "4-bedroom".
 * Returns null for things like "Villa", "Studio", "Plot", "PH".
 */
function bedroomCount(s?: string | null): number | null {
  const n = normaliseConfig(s);
  const m = n.match(/^(\d+)(?:br|bhk|bed|bedroom|bedrooms)?$/);
  if (m) return Number(m[1]);
  // also catch "studio" → 0 to allow matching against "0BHK" if anyone seeds it that way
  if (n === "studio") return 0;
  return null;
}

/**
 * Score how well a unit's configuration matches the lead's desired one.
 *   exact normalised match           → +10  (e.g. "2BHK" vs "2bhk")
 *   bedroom count matches            → +5   (e.g. "2BR" vs "2BHK")
 *   one side is non-numeric (Villa)
 *   and the OTHER side normalises    → -5   (no match)
 *   both sides missing               →  0   (nothing to compare)
 */
function configScore(lead: string | null | undefined, unit: string | null | undefined): number {
  const a = normaliseConfig(lead);
  const b = normaliseConfig(unit);
  if (!a || !b) return 0;
  if (a === b) return 10;
  const aBed = bedroomCount(lead);
  const bBed = bedroomCount(unit);
  if (aBed !== null && bBed !== null && aBed === bBed) return 5;
  // also treat "villa" / "penthouse" substring overlap as partial
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 5;
  return -5;
}

export async function bestUnitsForLead(leadId: string, limit = 3): Promise<SuggestedUnit[]> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      budgetMin: true,
      budgetMax: true,
      budgetCurrency: true,
      configuration: true,
      forwardedTeam: true,
    },
  });
  if (!lead) return [];

  const country = countryForTeam(lead.forwardedTeam);
  if (!country) return [];
  if (lead.budgetMin == null || lead.budgetMin <= 0) return [];

  // ±20% price band around budgetMin. If budgetMax is set and tighter on the
  // top end, respect it as the upper bound so we don't suggest units the lead
  // explicitly said they won't go above.
  const lo = lead.budgetMin * 0.8;
  const hiBand = lead.budgetMin * 1.2;
  const hi = lead.budgetMax && lead.budgetMax > 0 ? Math.min(hiBand, lead.budgetMax) : hiBand;
  if (hi < lo) return [];

  // Pre-filter at the DB layer to keep this cheap even with thousands of units.
  // We over-fetch (limit * 8, capped) so configuration scoring has a real pool
  // to rank from instead of getting whatever the DB returned first.
  const candidatePool = Math.min(Math.max(limit * 8, 24), 200);
  const units = await prisma.unit.findMany({
    where: {
      status: "AVAILABLE",
      priceBase: { gte: lo, lte: hi },
      project: { country },
    },
    include: { project: true },
    take: candidatePool,
    // Cheapest-fit first as a stable starting order — final order is by score.
    orderBy: { priceBase: "asc" },
  });
  if (units.length === 0) return [];

  // Compute score for each candidate. Price-fit bonus: closer to budgetMin = more.
  // Max ±5 swing on price; rounded so ties are clean.
  const budget = lead.budgetMin;
  const scored: SuggestedUnit[] = units.map((u) => {
    let score = 0;
    score += configScore(lead.configuration, u.configuration);
    const priceDelta = Math.abs(u.priceBase - budget) / budget; // 0..0.2
    score += Math.round((1 - priceDelta / 0.2) * 5); // 5 at exact match, 0 at edge
    // Small tiebreakers — only when present, only worth 1 point each.
    if (u.floor != null && u.floor >= 10) score += 1;
    if (u.view && /sea|marina|park|burj|skyline/i.test(u.view)) score += 1;
    return Object.assign(u, { score });
  });

  // Sort by score desc, then by price asc (cheaper wins ties — better fit
  // intent for first-suggestion clients who tend to under-state budget).
  scored.sort((a, b) => (b.score - a.score) || (a.priceBase - b.priceBase));

  return scored.slice(0, limit);
}

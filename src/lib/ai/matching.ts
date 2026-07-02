// AI Sales OS — Buyer ↔ Seller matching engine (M2), PURE + unit-testable core.
// Given a seller's PROPERTY and a pool of BUYER requirements, rank the buyers whose
// need fits the property — with EXPLAINABLE reasons. Deterministic (no LLM): budget
// / market / city / configuration are hard signals. MARKET IS A HARD GATE — an
// India buyer is NEVER matched to a UAE property (currency never mixes). The IO
// wrapper (load sellers + scoped buyer pool) is M3; this stays pure.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiConfidence } from "./types";

export type Market = "India" | "UAE";

export interface PropertySpec {
  id: string;
  market: Market | null;
  city: string | null;
  configuration: string | null;   // "2BR", "3BHK", …
  askingBudget: number | null;    // price in the market's own currency (never converted)
}

export interface BuyerSpec {
  id: string;
  name: string;
  market: Market | null;
  preferredCity: string | null;
  configuration: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

export interface MatchReason { key: string; detail: string; }

export interface RankedMatch {
  buyerId: string;
  buyerName: string;
  score: number;            // 0..1
  confidence: AiConfidence;
  reasons: MatchReason[];   // WHY — explainable
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Score one buyer against the property. Returns null when the MARKET gate fails
 *  (mismatched or unknown market) — a hard exclusion, never a low score. */
function scoreBuyer(prop: PropertySpec, b: BuyerSpec): RankedMatch | null {
  // Hard gate: market must match + be known (never cross India/UAE — currency rule).
  if (!prop.market || !b.market || prop.market !== b.market) return null;

  const reasons: MatchReason[] = [{ key: "market", detail: `Same market (${prop.market})` }];
  let score = 0.3; // market match is the floor for a candidate

  // Budget — the strongest signal. Asking price within the buyer's band = full points.
  if (prop.askingBudget != null && (b.budgetMin != null || b.budgetMax != null)) {
    const lo = b.budgetMin ?? 0;
    const hi = b.budgetMax ?? Number.POSITIVE_INFINITY;
    if (prop.askingBudget >= lo && prop.askingBudget <= hi) {
      score += 0.4; reasons.push({ key: "budget", detail: "Asking price is within budget" });
    } else if (hi !== Number.POSITIVE_INFINITY && prop.askingBudget <= hi * 1.1) {
      score += 0.2; reasons.push({ key: "budget", detail: "Asking price is close to budget (≤10% over)" });
    }
  }

  // City / community.
  if (prop.city && b.preferredCity && norm(prop.city) === norm(b.preferredCity)) {
    score += 0.2; reasons.push({ key: "city", detail: `Same location (${prop.city})` });
  }

  // Configuration (2BR/3BHK).
  if (prop.configuration && b.configuration && norm(prop.configuration) === norm(b.configuration)) {
    score += 0.15; reasons.push({ key: "config", detail: `Same configuration (${prop.configuration})` });
  }

  score = Math.min(1, score);
  // Need MORE than the bare market floor to be a real match.
  if (score <= 0.3) return null;

  const confidence: AiConfidence = score >= 0.7 ? "high" : score >= 0.5 ? "medium" : "low";
  return { buyerId: b.id, buyerName: b.name, score, confidence, reasons };
}

/** Ranked buyer matches for a property (best first). Market-gated, explainable. */
export function matchBuyersToProperty(prop: PropertySpec, buyers: BuyerSpec[]): RankedMatch[] {
  const out: RankedMatch[] = [];
  for (const b of buyers) {
    const m = scoreBuyer(prop, b);
    if (m) out.push(m);
  }
  return out.sort((a, b) => b.score - a.score);
}

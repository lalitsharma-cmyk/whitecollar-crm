import "server-only";
// AI Sales OS — matching IO wrapper (M3). Loads a seller's property + the scoped
// buyer pool from LIVE data, maps them to the pure M2 specs, and returns ranked,
// explainable buyer matches. READ-ONLY. Market is derived with the CRM's own
// resolveMarket so the AI never mixes India/UAE (currency rule).
//
// NOTE (deferred seller-inventory fields): a Sale Off lead's property is
// approximated from the lead's own city/configuration/budgetMin (as asking). When
// the seller-inventory schema (askingPrice/size/tower/…) lands, swap those in here
// only — the pure matching core (matching.ts) is unchanged.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { resolveMarket } from "@/lib/market";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { matchBuyersToProperty, type PropertySpec, type BuyerSpec, type RankedMatch, type Market } from "./matching";

const asMarket = (m: string | null): Market | null => (m === "India" || m === "UAE" ? m : null);

/** Ranked buyer matches for a seller's property lead. Empty if the property has no
 *  resolvable market (hard gate) or the lead doesn't exist. */
export async function findBuyerMatchesForProperty(propertyLeadId: string, limit = 20): Promise<RankedMatch[]> {
  const seller = await prisma.lead.findUnique({
    where: { id: propertyLeadId },
    select: { id: true, city: true, configuration: true, budgetMin: true, forwardedTeam: true, budgetCurrency: true, market: true, deletedAt: true },
  });
  if (!seller || seller.deletedAt) return [];

  const prop: PropertySpec = {
    id: seller.id,
    market: asMarket(resolveMarket(seller)),
    city: seller.city,
    configuration: seller.configuration,
    askingBudget: seller.budgetMin,
  };
  if (!prop.market) return []; // market gate — no market, no match

  // Buyer pool: live, workable leads in the SAME market that carry a budget, minus
  // the seller itself. Filter by market at the DB level to keep the pool small.
  const teamForMarket = prop.market === "India" ? "India" : "Dubai";
  const buyers = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      id: { not: seller.id },
      currentStatus: { notIn: TERMINAL_STATUSES },
      OR: [{ market: prop.market }, { forwardedTeam: teamForMarket }],
      AND: [{ OR: [{ budgetMin: { not: null } }, { budgetMax: { not: null } }] }],
    },
    select: { id: true, name: true, city: true, configuration: true, budgetMin: true, budgetMax: true, forwardedTeam: true, budgetCurrency: true, market: true },
    take: 4000,
  });

  const buyerSpecs: BuyerSpec[] = buyers.map((b) => ({
    id: b.id,
    name: b.name,
    market: asMarket(resolveMarket(b)),
    preferredCity: b.city,
    configuration: b.configuration,
    budgetMin: b.budgetMin,
    budgetMax: b.budgetMax,
  }));

  return matchBuyersToProperty(prop, buyerSpecs).slice(0, limit);
}

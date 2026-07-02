import "server-only";
// AI Sales OS — data-quality scan (M4 self-heal), READ-ONLY IO wrapper. Finds leads
// whose market is empty but derivable and returns reversible fix SUGGESTIONS. Market
// derivation goes through the CRM's own resolveMarket (one source of truth, currency
// rule). Never writes — apply is a separate, approved step (/api/ai/apply).
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { prisma } from "@/lib/prisma";
import { resolveMarket } from "@/lib/market";
import { marketFixSuggestion, type DqMarket } from "./dataQuality";
import type { AiSuggestion } from "./types";

const asDq = (m: string | null): DqMarket | null => (m === "India" || m === "UAE" ? m : null);

/** Read-only: leads with empty market that CAN be derived → reversible fix suggestions. */
export async function scanMarketFixes(limit = 100): Promise<AiSuggestion[]> {
  const rows = await prisma.lead.findMany({
    where: { deletedAt: null, OR: [{ market: null }, { market: "" }] },
    select: { id: true, market: true, forwardedTeam: true, budgetCurrency: true },
    take: limit,
  });

  const out: AiSuggestion[] = [];
  for (const r of rows) {
    const derived = asDq(resolveMarket({ market: null, forwardedTeam: r.forwardedTeam, budgetCurrency: r.budgetCurrency }));
    const s = marketFixSuggestion({
      leadId: r.id,
      currentMarket: r.market,
      derived,
      basis: { team: r.forwardedTeam, currency: r.budgetCurrency },
    });
    if (s) out.push(s);
  }
  return out;
}

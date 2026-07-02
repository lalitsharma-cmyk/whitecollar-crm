// AI Sales OS — data-quality / self-heal detector (M4), PURE + unit-testable.
// The FIRST producer of a reversible mutation: when a lead's market is empty but
// derivable (from its team/currency), propose setting it. Read-Only-First — this only
// SUGGESTS; the write happens later via /api/ai/apply after human approval.
//
// Market derivation itself lives in the CRM's own src/lib/market.ts (one source of
// truth); the server layer computes `derived` and passes it in, so this stays pure.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiSuggestion } from "./types";

export type DqMarket = "India" | "UAE";

export interface MarketFixInput {
  leadId: string;
  currentMarket: string | null;   // Lead.market as stored
  derived: DqMarket | null;       // resolveMarket() computed by the caller (server)
  basis: { team?: string | null; currency?: string | null };
}

/** Propose a reversible market fix, or null when there's nothing safe to do:
 *  market already classified, OR not derivable (leave in "Awaiting Market" — never guess). */
export function marketFixSuggestion(input: MarketFixInput): AiSuggestion | null {
  const current = (input.currentMarket ?? "").trim();
  if (current === "India" || current === "UAE") return null; // already classified
  if (!input.derived) return null;                            // unclassifiable — no guess

  const via = input.basis.team
    ? `team (${input.basis.team})`
    : input.basis.currency
      ? `currency (${input.basis.currency})`
      : "existing signals";

  return {
    id: `dq.market.${input.leadId}`,
    detectionId: null,
    action: "fix.market",
    rationale: `Market is empty but the record's ${via} implies ${input.derived}. Setting it is fully reversible.`,
    confidence: input.basis.team ? "high" : "medium", // team is authoritative; currency is a softer signal
    routeToRole: "ADMIN",
    mutation: {
      entity: "Lead",
      entityId: input.leadId,
      field: "market",
      from: current || null,
      to: input.derived,
      reversible: true,
    },
  };
}

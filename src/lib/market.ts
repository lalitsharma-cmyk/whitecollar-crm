// market.ts — the ONE source of truth for MARKET (India / UAE), which is DISTINCT
// from TEAM (India Team / Dubai Team). Permanent segregation rule (Lalit 2026-07-02):
//   • Team   = who works the record  → Lead.forwardedTeam ("India" | "Dubai")
//   • Market = the property market    → Lead.market        ("India" | "UAE")
// Never mix them. Every market-scoped feature (Sale Off, India Buyer, Revival split,
// reports, dashboards, search, filters) resolves market through here — no forked logic.
// Pure module (no prisma/server-only) so list pages, filters, and the regression suite
// can all import it.

export const MARKETS = ["India", "UAE"] as const;
export type Market = (typeof MARKETS)[number];

/** Map a TEAM value (forwardedTeam: "India" | "Dubai" | "Gurgaon" | "UAE") → MARKET. */
export function teamToMarket(team: string | null | undefined): Market | null {
  const t = (team ?? "").trim().toLowerCase();
  if (t === "india" || t === "gurgaon" || t === "gurugram") return "India";
  if (t === "dubai" || t === "uae") return "UAE";
  return null;
}

/** Map a currency → MARKET (fallback signal for records with no team). */
export function currencyToMarket(ccy: string | null | undefined): Market | null {
  const c = (ccy ?? "").trim().toUpperCase();
  if (c === "INR") return "India";
  if (c === "AED") return "UAE";
  return null;
}

/**
 * Resolve a record's Market: explicit `market` first, else derive from the Team
 * (forwardedTeam), else from currency. Returns null only when truly unclassifiable
 * (surfaces in an "Awaiting Market" bucket rather than being silently misfiled).
 */
export function resolveMarket(rec: {
  market?: string | null;
  forwardedTeam?: string | null;
  budgetCurrency?: string | null;
}): Market | null {
  const m = (rec.market ?? "").trim();
  if (m === "India" || m === "UAE") return m;
  return teamToMarket(rec.forwardedTeam) ?? currencyToMarket(rec.budgetCurrency);
}

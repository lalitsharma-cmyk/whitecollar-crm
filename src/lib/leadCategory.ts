// ────────────────────────────────────────────────────────────────────────────
// src/lib/leadCategory.ts — market-specific buyer "Categorization" options.
//
// An India lead must NOT be taggable with UAE-resident categories, and a Dubai
// lead must not show India-only ones. The picker options derive from the lead's
// Team/Market. Shared so the New-Lead form, Edit form, filters and reports all use
// ONE source of truth. (Lalit 2026-06-28)
//
// Casing matches the EXISTING stored values for the shared options ("NRI Investor",
// "NRI End-user", "First-time buyer") so we don't fragment historical data; the
// India-only "Indian …" variants follow the same "End-user" style.
//
// Pure module (no "server-only") — client components AND the regression suite import it.
// ────────────────────────────────────────────────────────────────────────────

export const LEAD_CATEGORIES_INDIA = [
  "Indian Investor",
  "Indian End-user",
  "NRI Investor",
  "NRI End-user",
  "First-time buyer",
] as const;

export const LEAD_CATEGORIES_DUBAI = [
  "UAE Resident Investor",
  "UAE Resident End-user",
  "NRI Investor",
  "NRI End-user",
  "International Investor",
  "First-time buyer",
] as const;

/** Categories valid for a team/market. No team yet → the de-duped union, so the
 *  field still works before a team is chosen (the form re-filters once it is). */
export function categoryOptionsForTeam(team: string | null | undefined): string[] {
  if (team === "India") return [...LEAD_CATEGORIES_INDIA];
  if (team === "Dubai") return [...LEAD_CATEGORIES_DUBAI];
  return [...new Set<string>([...LEAD_CATEGORIES_INDIA, ...LEAD_CATEGORIES_DUBAI])];
}

/** Every valid category across both markets — for validation WITHOUT blindly
 *  rewriting historical data (an existing out-of-market value stays, but can be
 *  flagged in the UI). */
export const ALL_LEAD_CATEGORIES = [...new Set<string>([...LEAD_CATEGORIES_INDIA, ...LEAD_CATEGORIES_DUBAI])];

/** True when `category` is a valid choice for the given team (used to warn on an
 *  out-of-market existing value without overwriting it). Blank is always allowed. */
export function isCategoryValidForTeam(category: string | null | undefined, team: string | null | undefined): boolean {
  if (!category) return true;
  return categoryOptionsForTeam(team).includes(category);
}

// Smart budget input parser.
//
// Lalit asked: "Allow K (thousand), M (Million) in Dubai. and Cr and Lakh in India"
// — so agents can type "2.5M", "30L", "3Cr", "500K" instead of "2500000".
// The parser returns the raw numeric value the DB stores; the UI shows a
// human-readable preview ("2,500,000 AED ≈ 2.5M AED") so the agent can sanity-
// check before saving.
//
// Supported suffixes (case-insensitive, space optional):
//   K   → × 1,000          ("500K" → 500,000)
//   L   → × 100,000        ("30L" → 3,000,000)     India only
//   Cr  → × 10,000,000     ("3Cr" → 30,000,000)    India only
//   M   → × 1,000,000      ("2.5M" → 2,500,000)
//   Mn  → × 1,000,000      same as M
//   Bn  → × 1,000,000,000  ("1.2Bn" → 1,200,000,000)
//
// Plain numbers (no suffix) pass through unchanged.

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  l: 100_000,
  lakh: 100_000,
  lakhs: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
  m: 1_000_000,
  mn: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  bn: 1_000_000_000,
  billion: 1_000_000_000,
};

/**
 * Parse "2.5M" / "30 L" / "3 cr" / "5,00,000" / "500K" → number.
 * Returns null when the input can't be interpreted as a positive number.
 */
export function parseBudget(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return isFinite(raw) && raw >= 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  // Strip currency words (whole tokens — not individual letters or we'd eat the
  // 'a' out of "Lakh", 'r' out of "Cr", etc.), then strip commas + whitespace.
  // Order matters: words first, then chars.
  const clean = s
    .replace(/\b(?:AED|INR|USD|Rs\.?|Rupees?)\b/gi, "")
    .replace(/[,\s$₹]/g, "");
  // Split into "<number><suffix>". Suffix is letters at the end.
  const m = clean.match(/^(\d+(?:\.\d+)?)([a-zA-Z]*)$/);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (isNaN(value) || value < 0) return null;
  const suffix = m[2].toLowerCase();
  if (!suffix) return value;
  const mult = MULTIPLIERS[suffix];
  if (!mult) return null; // unknown suffix — refuse rather than guess
  return value * mult;
}

// Fixed internal AED⇄INR conversion rate (Lalit, 2026-06-23): 1 AED = 26 INR.
// Used ONLY to render a Dubai-team lead's INR-entered budget in AED on Lead
// View / List (task 10). DISPLAY-ONLY: stored budgetMin/Max/Currency are never
// mutated, and reports aggregate AED/INR SEPARATELY (fmtMoneyDual) — they do not
// use this. To change the rate, edit this single constant.
export const AED_INR_RATE = 26;

/** Convert an INR amount to AED at the fixed internal rate. Display-only. */
export function inrToAed(inr: number): number {
  return inr / AED_INR_RATE;
}

/**
 * Render a number back in the most natural unit for the given currency.
 *   AED 2,500,000 → "2.5M AED"
 *   INR 30,000,000 → "3 Cr"
 */
export type BudgetMarket = "DUBAI" | "INDIA";

/** Dubai/UAE house format: "2M AED", "600K AED" — value+unit glued, single space,
 *  AED at the END. M/K/AED uppercase, no dots, no extra spaces. */
function fmtDubai(n: number): string {
  if (n >= 1_000_000_000) return `${trimZeros(n / 1_000_000_000)}B AED`;
  if (n >= 1_000_000)     return `${trimZeros(n / 1_000_000)}M AED`;
  if (n >= 1_000)         return `${trimZeros(n / 1_000)}K AED`;
  return `${trimZeros(n)} AED`;
}
/** India house format: "21 Cr", "50 L" — value SPACE unit; "Cr" = capital-C small-r,
 *  "L" capital; no ₹, no dots, no forced decimals. */
function fmtIndia(n: number): string {
  if (n >= 10_000_000) return `${trimZeros(n / 10_000_000)} Cr`;
  if (n >= 100_000)    return `${trimZeros(n / 100_000)} L`;
  if (n >= 1_000)      return `${trimZeros(n / 1_000)} K`;
  return `${trimZeros(n)}`;
}

/** THE canonical numeric→display formatter. Dubai → "2M AED"; India → "21 Cr". */
export function formatBudgetAmount(amount: number | null | undefined, market: BudgetMarket): string {
  if (amount == null || !isFinite(amount) || amount <= 0) return "—";
  return market === "INDIA" ? fmtIndia(amount) : fmtDubai(amount);
}

/** Back-compat shim: legacy callers pass a currency string. Routes to the
 *  canonical formatter so every budget renders in the uniform house format
 *  (Dubai "2M AED", India "21 Cr") instead of the old "2.5 M" / "3 Cr". */
export function formatBudget(n: number | null | undefined, currency: "AED" | "INR" | string = "AED"): string {
  return formatBudgetAmount(n ?? null, currency === "INR" ? "INDIA" : "DUBAI");
}

function trimZeros(n: number): string {
  // 2.50 → "2.5", 3 → "3", 1.234 → "1.23"
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * THE canonical, TEAM-AWARE budget display (uniform house format, 2026-06-21):
 *   • Dubai / UAE / unknown team → "2M AED", "600K AED" (value+unit, space, AED end).
 *   • India / Gurgaon team       → "21 Cr", "50 L" (value, space, Cr/L; no ₹/dots).
 * Market: forwardedTeam first, else budgetCurrency (INR ⇒ India).
 *
 * DISPLAY-ONLY — stored budgetMin/Max/Raw/Currency, filters, reports, and sorting
 * are NEVER changed. budgetRaw is a parse SOURCE only; it is no longer echoed
 * verbatim (verbatim raw is what produced "AED 2 M", "2 M AED", "21CR", "21.0 Cr").
 * Supersedes the earlier "show raw verbatim" rule per Lalit's standardisation spec.
 */
export function displayBudget(lead: {
  budgetRaw?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
  forwardedTeam?: string | null;
}): string {
  const team = (lead.forwardedTeam ?? "").trim().toLowerCase();
  const ccy = (lead.budgetCurrency || "").toUpperCase();
  const market: BudgetMarket =
    team === "india" || team === "gurgaon" || team === "gurugram" ? "INDIA"
    : team === "dubai" ? "DUBAI"
    : ccy === "INR" ? "INDIA"
    : "DUBAI";

  // Prefer the parsed numeric value; else re-parse the raw cell into a number.
  let min = (lead.budgetMin != null && lead.budgetMin > 0) ? lead.budgetMin : parseBudget(lead.budgetRaw);
  if (min == null || min <= 0) {
    // No usable number anywhere. Never blank out a budget that has SOME number —
    // show the trimmed raw as a last resort; otherwise "—".
    const raw = lead.budgetRaw?.trim();
    return raw && /\d/.test(raw) ? raw : "—";
  }
  let max = (lead.budgetMax != null && lead.budgetMax > min) ? lead.budgetMax : null;

  // Dubai-team lead whose budget was ENTERED in INR → convert INR→AED for display
  // at the fixed internal rate (1 AED = 26 INR, task 10). Only this case: market
  // resolves to DUBAI but the stored currency is INR. Display-only — the stored
  // INR value is untouched; the agent's edit field still shows the raw INR.
  if (market === "DUBAI" && ccy === "INR") {
    min = inrToAed(min);
    if (max != null) max = inrToAed(max);
  }

  const lo = formatBudgetAmount(min, market);
  if (max) {
    if (market === "DUBAI") {
      // Keep a single trailing "AED" on a Dubai range: "1M – 2M AED".
      const loN = lo.replace(/\s*AED$/, "");
      const hiN = formatBudgetAmount(max, market).replace(/\s*AED$/, "");
      return `${loN} – ${hiN} AED`;
    }
    return `${lo} – ${formatBudgetAmount(max, market)}`;
  }
  return ccy === "UNKNOWN" ? `${lo} (currency?)` : lo;
}

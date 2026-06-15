// Market-based budget currency resolution + range parsing.
//
// Governing rules (user spec, 2026-06-15):
//   Dubai/UAE → AED, India/Gurgaon/NCR → INR. NEVER convert or mix.
//   Currency is resolved by a STRICT priority order; when nothing is confident
//   the answer is "UNKNOWN" — we never guess AED/INR, because a WRONG currency
//   is worse than an unknown one. UNKNOWN leads show budgetRaw only and are
//   flagged for admin review (admins can later run "Recalculate Currency").
//
// Priority: 1 explicit currency col/symbol → 2 project country → 3 project-name
//           / developer mapping → 4 source sheet → 5 team assignment → UNKNOWN.

import { parseBudget } from "./budgetParse";

export type BudgetCurrency = "AED" | "INR" | "UNKNOWN";

// Market-tagged project / developer / area keywords. ONLY list UNAMBIGUOUS
// signals — a developer that builds in BOTH markets (bare "sobha", "prestige")
// must NOT decide currency, so list only market-specific phrases ("sobha dubai").
const AED_KEYWORDS = [
  // Dubai/UAE developers + master communities (user-named first)
  "dubai hills", "damac", "sobha dubai", "emaar", "danube", "nakheel", "aldar",
  "omniyat", "azizi", "binghatti", "meraas", "ellington", "meydan", "wasl",
  "reportage", "expo city", "damac hills",
  // Dubai/UAE areas + emirates
  "dubai", "abu dhabi", "sharjah", "ajman", "ras al khaimah", "uae",
  "business bay", "dubai marina", "jvc", "jvt", "jbr", "palm jumeirah",
  "arabian ranches", "downtown dubai",
];
const INR_KEYWORDS = [
  // India developers (user-named first)
  "dlf", "m3m", "smartworld", "tarc", "godrej", "signature global", "elan",
  "silverglades", "lodha", "shapoorji", "puravankara", "brigade",
  "rustomjee", "hiranandani", "experion", "central park", "trump tower",
  // India areas
  "india", "gurgaon", "gurugram", "delhi", "ncr", "noida", "ghaziabad",
  "faridabad", "golf course road", "dwarka", "sohna", "mumbai", "pune",
  "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "sector",
];

const lc = (s?: string | null) => (s ?? "").toLowerCase();

/** Project / developer / area name → market currency. Ambiguous or none → null (defer). */
export function currencyFromProjectName(name?: string | null): BudgetCurrency | null {
  const n = lc(name);
  if (!n.trim()) return null;
  const aed = AED_KEYWORDS.some((k) => n.includes(k));
  const inr = INR_KEYWORDS.some((k) => n.includes(k));
  if (aed && !inr) return "AED";
  if (inr && !aed) return "INR";
  return null; // none, or matched both → do not decide
}

function currencyFromCountry(country?: string | null): BudgetCurrency | null {
  const c = lc(country);
  if (!c) return null;
  if (c.includes("india")) return "INR";
  if (c.includes("uae") || c.includes("emirates") || c.includes("dubai")) return "AED";
  return null;
}

/** Normalize an explicit currency column / symbol to AED | INR (or null). */
export function normalizeExplicitCurrency(ccy?: string | null): BudgetCurrency | null {
  const c = lc(ccy);
  if (!c.trim()) return null;
  if (c === "unknown") return null; // treat a literal "UNKNOWN" cell as "no signal"
  if (c.includes("aed") || c.includes("dirham") || c.includes("dhs")) return "AED";
  if (c.includes("inr") || c.includes("rupee") || /(^|[^a-z])rs\.?($|[^a-z])/.test(c) || c.includes("₹")) return "INR";
  return null;
}

function teamCurrency(team?: string | null): BudgetCurrency | null {
  const t = lc(team).trim();
  if (t === "dubai") return "AED";
  if (t === "india") return "INR";
  return null;
}

export interface CurrencySignals {
  explicit?: string | null;     // 1. explicit currency column / symbol (highest)
  country?: string | null;      // 2. project / lead country
  projectName?: string | null;  // 3. project-name / developer mapping
  sheetName?: string | null;    // 4. source sheet / file name
  team?: string | null;         // 5. team assignment (last resort)
}

/**
 * Resolve budget currency by STRICT priority. Returns "UNKNOWN" when no signal
 * is confident — never guesses. "Wrong currency is worse than unknown currency."
 */
export function resolveBudgetCurrency(s: CurrencySignals): BudgetCurrency {
  return (
    normalizeExplicitCurrency(s.explicit) ??   // 1
    currencyFromCountry(s.country) ??          // 2
    currencyFromProjectName(s.projectName) ??  // 3
    currencyFromProjectName(s.sheetName) ??    // 4 (sheet/file name scanned like a project/area phrase)
    teamCurrency(s.team) ??                     // 5
    "UNKNOWN"
  );
}

/**
 * Parse a budget RANGE cell ("10-12 Cr", "AED 800K - AED 1M", "4 Cr - 5 Cr").
 * Unit inheritance: if the left side has no magnitude unit but the right does,
 * the left borrows it — so "10-12 Cr" → 10 Cr .. 12 Cr (NOT 10 .. 12 Cr).
 * Returns null when the cell is not a range.
 */
export function parseBudgetRange(cell?: string | null): { min: number | null; max: number | null } | null {
  const s = (cell ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(.+?)\s*(?:[-–—]|\bto\b)\s*(.+)$/i);
  if (!m) return null;
  let left = m[1].trim();
  const right = m[2].trim();
  // Strip currency WORDS/symbols before testing for a magnitude unit (k/l/cr/m/bn).
  const stripCcy = (x: string) => x.replace(/\b(?:aed|inr|usd|rs\.?|rupees?|dhs)\b/gi, "").replace(/[₹$]/g, "");
  const leftHasUnit = /[a-z]/i.test(stripCcy(left));
  if (!leftHasUnit) {
    const rightUnit = stripCcy(right).match(/([a-z]+)\s*$/i);
    if (rightUnit) left = `${left}${rightUnit[1]}`;
  }
  const min = parseBudget(left);
  const max = parseBudget(right);
  if (min == null && max == null) return null;
  return { min, max };
}

/**
 * Interpret a budget field from a min-cell (which may itself be a range) and an
 * optional separate max-cell. Returns the VERBATIM raw text plus numeric min/max.
 *   interpretBudget("4 Cr - 5 Cr")        → { raw:"4 Cr - 5 Cr", min:40000000, max:50000000 }
 *   interpretBudget("AED 800K","AED 1M")  → { raw:"AED 800K - AED 1M", min:800000, max:1000000 }
 *   interpretBudget("10 Cr")              → { raw:"10 Cr", min:100000000, max:null }
 */
export function interpretBudget(minCell?: string | null, maxCell?: string | null): {
  raw: string | null; min: number | null; max: number | null;
} {
  const minS = (minCell ?? "").trim();
  let maxS = (maxCell ?? "").trim();
  // A single "Budget" column gets matched as BOTH min and max by the fuzzy header
  // picker ("budgetmax".startsWith("budget")), so an identical max is not a real
  // upper bound — drop it (otherwise "75 Lakh" → "75 Lakh - 75 Lakh").
  if (maxS && maxS === minS) maxS = "";
  const range = parseBudgetRange(minS);
  if (range) return { raw: minS, min: range.min, max: range.max };
  const min = minS ? parseBudget(minS) : null;
  const max = maxS ? parseBudget(maxS) : null;
  const raw = minS && maxS ? `${minS} - ${maxS}` : minS || maxS || null;
  return { raw, min, max };
}

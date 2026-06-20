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

/**
 * Render a number back in the most natural unit for the given currency.
 *   AED 2,500,000 → "2.5M AED"
 *   INR 30,000,000 → "3 Cr"
 */
export function formatBudget(n: number | null | undefined, currency: "AED" | "INR" | string = "AED"): string {
  if (n == null || !isFinite(n) || n === 0) return "—";
  const isINR = currency === "INR";
  if (isINR) {
    if (n >= 10_000_000) return `${trimZeros(n / 10_000_000)} Cr`;
    if (n >= 100_000)    return `${trimZeros(n / 100_000)} L`;
    if (n >= 1_000)      return `${trimZeros(n / 1_000)} K`;
    return `${n.toLocaleString("en-IN")}`;
  }
  // AED / USD / other — use M/K
  if (n >= 1_000_000_000) return `${trimZeros(n / 1_000_000_000)} Bn`;
  if (n >= 1_000_000)     return `${trimZeros(n / 1_000_000)} M`;
  if (n >= 1_000)         return `${trimZeros(n / 1_000)} K`;
  return `${n.toLocaleString("en-US")}`;
}

function trimZeros(n: number): string {
  // 2.50 → "2.5", 3 → "3", 1.234 → "1.23"
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}

/** India/Gurgaon budgets ALWAYS render in INR Lakh/Cr — never Millions/AED.
 *  Formats the stored NUMERIC value (no blind conversion); the verbatim raw is
 *  preserved in the DB, only the display is normalised. Returns null if there's
 *  no usable number. Matches Lalit's examples: "₹50 Lakh", "₹1.25 Cr", "₹7 Cr". */
function formatINR(min?: number | null, max?: number | null): string | null {
  if (min == null || min === 0) return null;
  // Lalit's standard (2026-06-20): "3 CR", "5.5 CR", "50 LAKH" — NO ₹ symbol, NO
  // trailing dot, UPPERCASE unit, a single space before the unit. Display-only;
  // the numeric value (budgetMin) is what filters/reports/sorting use.
  const fmt = (n: number) =>
    n >= 10_000_000 ? `${trimZeros(n / 10_000_000)} CR`
    : n >= 100_000  ? `${trimZeros(n / 100_000)} LAKH`
    : n >= 1_000    ? `${trimZeros(n / 1_000)} K`
    : `${n.toLocaleString("en-IN")}`;
  const lo = fmt(min);
  const hi = max && max > min ? fmt(max) : null;
  return hi ? `${lo} – ${hi}` : lo;
}

/**
 * Canonical, TEAM-AWARE budget display (Lalit's rule, 2026-06-20):
 *   • India / Gurgaon team → INR Lakh/Cr ONLY (never "1M"/"AED"). Rendered from
 *     the numeric value so a sheet that wrote "7M" shows "₹70 Lakh", and a lead
 *     wrongly tagged AED still shows ₹ (team wins over a stale currency).
 *   • Dubai (and unknown team) → verbatim raw wins ("AED 800K - 1M"), else AED K/M.
 * Team is taken from forwardedTeam; when absent we fall back to budgetCurrency
 * (INR ⇒ India format, AED ⇒ Dubai format) so every caller is covered.
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
  const isIndia = team === "india" || team === "gurgaon" || team === "gurugram" || (!team && ccy === "INR");

  const raw = lead.budgetRaw?.trim();
  const rawIsBudget = !!raw && /\d/.test(raw); // a raw with no digit is corrupted (e.g. a leaked name)

  if (isIndia) {
    // INR Lakh/Cr from the numeric value; only if there's no number do we fall
    // back to the raw text (last resort), else "—".
    return formatINR(lead.budgetMin, lead.budgetMax) ?? (rawIsBudget ? raw! : "—");
  }

  // Dubai / unknown team — verbatim raw preferred, else AED (or stored ccy) K/M.
  if (rawIsBudget) return raw!;
  const min = lead.budgetMin;
  if (min == null || min === 0) return "—";
  const dispCcy = ccy && ccy !== "" ? ccy : "AED";
  if (dispCcy === "UNKNOWN") return `${min.toLocaleString("en-IN")} (currency?)`;
  const prefix = dispCcy === "INR" ? "₹" : dispCcy; // "AED 1.5 M", "₹ …"
  const lo = formatBudget(min, dispCcy);
  const hi = lead.budgetMax && lead.budgetMax > min ? formatBudget(lead.budgetMax, dispCcy) : null;
  return hi ? `${prefix} ${lo} – ${hi}` : `${prefix} ${lo}`;
}

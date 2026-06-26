// ────────────────────────────────────────────────────────────────────────────
// buyerIntelligence.ts — repeat-buyer rollup + key normalization for the Buyer
// Data module.
//
// DESIGN
//   • buyerKey is a normalized hash of (first+last name + last-8 digits of the
//     primary phone). Two transaction rows for the SAME human collapse onto one
//     key, which is how we detect a repeat buyer who owns multiple properties.
//   • The rollup (properties owned, total invested, first/latest purchase,
//     repeat-buyer flag) is COMPUTED at read time by grouping rows on buyerKey —
//     it is NOT stored, so it never goes stale and new dimensions (revenue,
//     brokerage, collection) can be layered on the same grouping later.
//   • JSON array fields (coBuyerNames, phones, emails) are stored as JSON strings;
//     the parse* helpers read them back defensively (string-JSON, real array, or
//     a bare comma/semicolon/pipe-separated string all work).
//
// Pure module (no "server-only", no prisma import) so it is unit-testable and
// usable from the regression harness.
// ────────────────────────────────────────────────────────────────────────────

// ── JSON array helpers ───────────────────────────────────────────────────────

/** Parse a stored JSON-array field (coBuyerNames / phones / emails) into a clean
 *  string[]. Tolerates: real JSON arrays, JSON strings, or a bare delimited
 *  string ("a, b; c | d"). Always returns trimmed, de-duplicated, non-empty
 *  entries — never throws. */
export function parseJsonArray(value: unknown): string[] {
  if (value == null) return [];
  let arr: unknown[] = [];
  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        arr = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        arr = s.split(/[,;|]/);
      }
    } else {
      arr = s.split(/[,;|]/);
    }
  } else {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const t = String(v ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Serialize a list of strings to the stored JSON-array form. Returns null when
 *  the cleaned list is empty (keeps the column NULL rather than "[]"). */
export function toJsonArray(values: (string | null | undefined)[]): string | null {
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = String(v ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(t);
  }
  return clean.length ? JSON.stringify(clean) : null;
}

/** First usable phone from a JSON/delimited phones field, else the explicit
 *  fallback (the single-phone column some sheets use). */
export function primaryPhone(phones: unknown, fallback?: string | null): string | null {
  const list = parseJsonArray(phones);
  if (list.length) return list[0];
  const f = String(fallback ?? "").trim();
  return f || null;
}

// ── buyerKey normalization ───────────────────────────────────────────────────

/** Digits only, last N (default 8). Last-8 (not last-10) keeps UAE & India
 *  mobile tails comparable without the country code dominating. */
function phoneTail(phone?: string | null, n = 8): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-n);
}

/** Lowercased, punctuation-stripped, whitespace-collapsed name. Honorifics
 *  (mr/mrs/ms/dr/m/s — "M/s") are dropped so "Mr. Rajesh Kumar" and "Rajesh
 *  Kumar" land on the same key. */
function normName(name?: string | null): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\b(?:mr|mrs|ms|miss|dr|m\/s|messrs|smt|shri|sri)\.?\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalized repeat-buyer key from client name + primary phone.
 *
 *   key = "<first> <last>|<last-8-phone-digits>"
 *
 * Why this shape:
 *   • Name alone collides distinct people ("Mohammed Ali"); phone alone misses
 *     a buyer who used two numbers. Pairing first+last name WITH the phone tail
 *     is the pragmatic middle that the WCR sheets actually support.
 *   • When the phone is absent we fall back to the full normalized name so a
 *     no-phone record still rolls up by name (matches the import-dedup policy:
 *     "dedup-on-name when phone absent").
 *
 * Returns null only when there is neither a usable name nor phone (nothing to
 * key on) — such a row is left un-rolled rather than colliding into a junk key.
 */
export function normalizeBuyerKey(clientName?: string | null, phone?: string | null): string | null {
  const tail = phoneTail(phone);
  const n = normName(clientName);
  if (!n && !tail) return null;

  // first + last token (drops middle names so "Rajesh K Kumar" ≈ "Rajesh Kumar").
  const parts = n.split(" ").filter(Boolean);
  const namePart = parts.length <= 1 ? (parts[0] ?? "") : `${parts[0]} ${parts[parts.length - 1]}`;

  if (tail) return `${namePart}|${tail}`;
  return `name:${n}`;
}

// ── rollup ───────────────────────────────────────────────────────────────────

/** Minimal shape the rollup needs — any object with these fields works
 *  (Prisma BuyerRecord satisfies it). */
export interface BuyerRollupInput {
  buyerKey?: string | null;
  transactionValue?: number | null;
  transactionDate?: Date | string | null;
}

export interface BuyerRollup {
  totalPropertiesOwned: number;
  totalInvestmentValue: number;
  firstPurchaseDate: Date | null;
  latestPurchaseDate: Date | null;
  repeatBuyerStatus: boolean;
}

function toDate(d: Date | string | null | undefined): Date | null {
  if (d == null) return null;
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x.getTime()) ? null : x;
}

/**
 * Roll up a set of records that (are assumed to) share a buyerKey.
 *   • totalPropertiesOwned  = number of records
 *   • totalInvestmentValue  = Σ transactionValue (nulls = 0)
 *   • firstPurchaseDate     = min transactionDate
 *   • latestPurchaseDate    = max transactionDate
 *   • repeatBuyerStatus     = records.length > 1
 * Composable: pass any pre-filtered slice (e.g. one buyerKey group, or all the
 * records for a project) and you get that slice's rollup.
 */
export function rollupForRecords(records: BuyerRollupInput[]): BuyerRollup {
  let total = 0;
  let first: Date | null = null;
  let latest: Date | null = null;
  for (const r of records) {
    const v = typeof r.transactionValue === "number" && isFinite(r.transactionValue) ? r.transactionValue : 0;
    total += v;
    const d = toDate(r.transactionDate);
    if (d) {
      if (!first || d < first) first = d;
      if (!latest || d > latest) latest = d;
    }
  }
  return {
    totalPropertiesOwned: records.length,
    totalInvestmentValue: total,
    firstPurchaseDate: first,
    latestPurchaseDate: latest,
    repeatBuyerStatus: records.length > 1,
  };
}

/** Group a flat list of records by buyerKey. Records with a null/blank buyerKey
 *  each become their OWN singleton group (keyed by a per-row sentinel) so an
 *  un-keyed row is treated as a unique single-property buyer, never merged with
 *  other un-keyed rows. */
export function groupByBuyerKey<T extends BuyerRollupInput & { id?: string }>(records: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  let solo = 0;
  for (const r of records) {
    const k = (r.buyerKey ?? "").trim() || `__solo_${r.id ?? solo++}`;
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  return groups;
}

/** Compute the rollup for ONE buyerKey out of an already-loaded record list
 *  (the list-page path: load once, group in memory, no extra query). */
export function computeBuyerRollup<T extends BuyerRollupInput>(
  buyerKey: string | null | undefined,
  allRecords: T[],
): BuyerRollup {
  const key = (buyerKey ?? "").trim();
  const slice = key ? allRecords.filter((r) => (r.buyerKey ?? "").trim() === key) : [];
  return rollupForRecords(slice);
}

// ── value formatting (mixed-currency buyer transactions) ─────────────────────

/** Compact money formatter for transaction values. Dubai projects price in AED,
 *  India in INR — the buyer sheet rarely carries an explicit currency column, so
 *  the caller passes the inferred currency (defaults to a neutral compact form).
 *  India → Cr/L; everything else → M/K with the currency suffix.
 *  This is DISPLAY-ONLY; the stored Float is never mutated. */
export function formatTxnValue(value: number | null | undefined, currency?: string | null): string {
  if (value == null || !isFinite(value) || value === 0) return "—";
  const ccy = (currency ?? "").toUpperCase();
  const round = (n: number) => {
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : String(r);
  };
  if (ccy === "INR" || ccy === "RS" || ccy === "₹") {
    if (value >= 1e7) return `${round(value / 1e7)} Cr`;
    if (value >= 1e5) return `${round(value / 1e5)} L`;
    return value.toLocaleString("en-IN");
  }
  // AED / USD / unspecified → M / K compact.
  const suffix = ccy ? ` ${ccy}` : "";
  if (value >= 1e6) return `${round(value / 1e6)}M${suffix}`;
  if (value >= 1e3) return `${round(value / 1e3)}K${suffix}`;
  return `${value.toLocaleString("en-US")}${suffix}`;
}

/** Guess the market currency for a buyer record from its country/nationality/
 *  project hints. Conservative: only returns INR for clear India signals, AED
 *  for clear UAE signals, else null (→ neutral compact display). */
export function inferBuyerCurrency(hint?: { nationality?: string | null; projectName?: string | null; source?: string | null; market?: string | null }): string | null {
  // Market is authoritative when known — a Dubai-market buyer is AED even if the
  // owner's nationality is Indian (audit fix 2026-06-27). Fall back to the text
  // heuristic only when there is no market.
  if (hint?.market === "Dubai") return "AED";
  if (hint?.market === "India") return "INR";
  const blob = `${hint?.nationality ?? ""} ${hint?.projectName ?? ""} ${hint?.source ?? ""}`.toLowerCase();
  if (/\b(india|indian|inr|mumbai|gurgaon|gurugram|delhi|noida|bengaluru|bangalore|pune)\b/.test(blob)) return "INR";
  if (/\b(uae|dubai|emirat|aed|abu dhabi|sharjah)\b/.test(blob)) return "AED";
  return null;
}

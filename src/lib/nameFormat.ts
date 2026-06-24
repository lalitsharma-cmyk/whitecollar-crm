// ────────────────────────────────────────────────────────────────────────────
// nameFormat.ts — Proper-Case (Title-Case) normalisation for STORED name data.
//
// Unlike leadName.ts / agentName.ts (which only reshape what is RENDERED), this
// is applied AT WRITE TIME so the value persisted to the DB is clean at source,
// and a one-off migration (scripts/normalize-names.ts) backfills existing rows.
//
//   "ABHISHEK ARORA"            → "Abhishek Arora"
//   "RAFIQ ALY HARRY MAHMOOD"   → "Rafiq Aly Harry Mahmood"
//   "MR. RISHI RAI CHANDHARY"   → "Mr. Rishi Rai Chandhary"
//   "AL-RASHID"                 → "Al-Rashid"
//   "O'BRIEN"                   → "O'Brien"
//
// SAFETY CONTRACT (do not relax):
//   • NAME fields ONLY. Never call this on email/phone/passport/company/project
//     codes/unit numbers/transaction ids/sourceRaw/etc.
//   • Idempotent: toProperCase(toProperCase(x)) === toProperCase(x).
//   • Only ALL-UPPERCASE or all-lowercase values are normalised (shouldNormalizeName).
//     Intentional mixed-case ("McDonald", "DeSouza", "JPMorgan", "O'Brien" once
//     cased) is PRESERVED untouched — normalizeName() is the guarded entry point.
//   • Values that are clearly NOT a human name — an email (contains "@"), a URL
//     (contains "://"), or a mostly-numeric code (unit number / txn id) — are
//     returned UNCHANGED, never reformatted.
// ────────────────────────────────────────────────────────────────────────────

// Honorific tokens that get a canonical Proper-Case form (with the trailing dot
// preserved when present). Keyed by the lowercased, dot-stripped token.
const HONORIFIC_CASING: Record<string, string> = {
  mr: "Mr",
  mrs: "Mrs",
  ms: "Ms",
  dr: "Dr",
  prof: "Prof",
  mx: "Mx",
};

/** True when the value looks like something we must NEVER reformat as a name:
 *  an email, a URL, or a token that is mostly digits / a code (unit no, txn id,
 *  passport, phone). Anything matching here is passed through verbatim. */
function looksNonName(s: string): boolean {
  if (s.includes("@")) return true;          // email
  if (s.includes("://")) return true;         // URL
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const digits = (s.match(/[0-9]/g) ?? []).length;
  // A pure code (no letters at all but has digits) — e.g. "30100", "A-1203".
  if (letters === 0 && digits > 0) return true;
  // Mostly-numeric with a few letters — e.g. unit "1203B", txn "TXN90021", a
  // PAN/passport "ABCDE1234F". Treat as a code when digits dominate the letters.
  if (digits > 0 && digits >= letters) return true;
  return false;
}

/** Lowercase a string WITHOUT the JS dotted-İ artifact. `String.toLowerCase()`
 *  maps Turkish capital İ (U+0130) to "i" + COMBINING DOT ABOVE (U+0307), which
 *  injects a stray combining mark into a name ("ŞİMŞEK" → "şi̇mşek"). Strip that
 *  one artifact — the combining dot directly following an ASCII i — so the name
 *  stays clean. No other precomposed diacritic is affected. */
function lowerNoArtifact(s: string): string {
  // ̇ = COMBINING DOT ABOVE — the artifact JS appends after lowercasing the
  // Turkish dotted capital İ (i + U+0307). Drop it so the name stays clean.
  return s.toLowerCase().replace(/i̇/g, "i");
}

/** Title-case ONE whitespace-delimited token, keeping internal punctuation
 *  (hyphen / apostrophe / period) and casing each sub-part: "AL-RASHID" →
 *  "Al-Rashid", "O'BRIEN" → "O'Brien", "MR." → "Mr.". */
function properCaseToken(token: string): string {
  if (!token) return token;

  // Honorific (with or without a trailing dot): "MR." / "mr" → "Mr." / "Mr".
  const dotless = token.replace(/\.+$/, "");
  const hadDot = token.length !== dotless.length;
  const hon = HONORIFIC_CASING[dotless.toLowerCase()];
  if (hon) return hadDot ? `${hon}.` : hon;

  // Split on hyphen/apostrophe/period but KEEP the delimiters, so each name
  // segment is cased independently and the punctuation is restored verbatim.
  //   "al-rashid"  → ["al", "-", "rashid"]   → "Al-Rashid"
  //   "o'brien"    → ["o", "'", "brien"]      → "O'Brien"
  const segments = token.split(/([-'.])/);
  return segments
    .map((seg) => {
      if (seg === "" || seg === "-" || seg === "'" || seg === ".") return seg; // delimiter, keep
      return seg.charAt(0).toUpperCase() + lowerNoArtifact(seg.slice(1));
    })
    .join("");
}

/**
 * Title-case a (possibly multi-word) name. Collapses runs of whitespace to a
 * single space and trims the ends. Returns the input UNCHANGED when it looks
 * like an email / URL / numeric code (see looksNonName).
 *
 *   toProperCase("ABHISHEK ARORA")          → "Abhishek Arora"
 *   toProperCase("MR.   RISHI  RAI")        → "Mr. Rishi Rai"
 *   toProperCase("john@x.com")              → "john@x.com"   (passthrough)
 */
export function toProperCase(name: string): string {
  if (name == null) return name;
  const trimmed = String(name).trim().replace(/\s+/g, " ");
  if (!trimmed) return trimmed;
  if (looksNonName(trimmed)) return trimmed;     // email / URL / code → verbatim
  return trimmed.split(" ").map(properCaseToken).join(" ");
}

/**
 * The SAFETY GUARD. TRUE only when the value is clearly un-cased — i.e. it has
 * cased letters and they are ALL upper OR ALL lower. FALSE for already-mixed-case
 * values (preserve intentional casing like "McDonald" / "DeSouza" / "JPMorgan"),
 * for non-name values (email/URL/code), and for empty/blank input.
 *
 *   shouldNormalizeName("ABHISHEK ARORA") → true   (all upper)
 *   shouldNormalizeName("abhishek arora") → true   (all lower)
 *   shouldNormalizeName("Abhishek Arora") → false  (already proper)
 *   shouldNormalizeName("McDonald")       → false  (intentional mixed case)
 *   shouldNormalizeName("a@b.com")        → false  (not a name)
 *   shouldNormalizeName("")               → false
 */
export function shouldNormalizeName(name: string | null | undefined): boolean {
  if (name == null) return false;
  const s = String(name).trim();
  if (!s) return false;
  if (looksNonName(s)) return false;              // never touch non-name values
  const letters = s.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) return false;          // no cased letters → nothing to do
  const upper = s === s.toUpperCase();
  const lower = s === s.toLowerCase();
  // All-upper or all-lower → un-cased (our target). Mixed case → leave it.
  return upper || lower;
}

/**
 * GUARDED entry point — the one to call everywhere. Proper-cases the value ONLY
 * when it is clearly un-cased (all-upper / all-lower); otherwise returns it
 * unchanged so intentional mixed-case and non-name values are preserved.
 * Null/undefined pass straight through (callers may hold optional fields).
 *
 *   normalizeName("ABHISHEK ARORA") → "Abhishek Arora"
 *   normalizeName("McDonald")       → "McDonald"   (unchanged)
 *   normalizeName(null)             → null
 */
export function normalizeName<T extends string | null | undefined>(name: T): T {
  if (name == null) return name;
  const s = String(name);
  return (shouldNormalizeName(s) ? toProperCase(s) : s) as T;
}

/**
 * Convenience for a delimited list of names stored as a single string
 * (e.g. a comma/slash/&-joined Lead.name holding multiple client names). Splits
 * on the SAME delimiters formatLeadName uses, normalises each part, and rejoins
 * with the original separators preserved. Used by the migration's preview/apply
 * for multi-name Lead.name cells. Per-part guard means a mixed-case part is kept.
 *
 *   normalizeNameList("ANIL RAJ, AVANTIKA NAIR") → "Anil Raj, Avantika Nair"
 */
export function normalizeNameList<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  const s = String(value);
  if (!s.trim()) return value;
  // Keep delimiters by splitting on a capturing group of [ , / & ; ] runs.
  const parts = s.split(/(\s*[,/&;]+\s*)/);
  const out = parts
    .map((p, i) => (i % 2 === 1 ? p : normalizeName(p)))  // odd indices are the delimiters
    .join("");
  return out as T;
}

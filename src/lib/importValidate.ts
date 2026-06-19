// Import field validation — the importer's defence against cross-field
// contamination and silent defaulting. Each function answers ONE question:
// "is this value actually valid for THIS field?" If not, the importer must
// leave the field BLANK rather than store a wrong value pulled from another
// column (e.g. an agent name in the email cell, a boolean in the status cell,
// a person's name in the budget cell). Source-sheet truth is preserved
// verbatim in rawImport / sourceRaw regardless.

/** A single, well-formed email or undefined. Rejects "tanuj", "false",
 *  comma-joined multi-emails, and anything without a real local@domain.tld. */
export function validEmail(s?: string | null): string | undefined {
  if (!s) return undefined;
  const v = s.trim();
  if (/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(v)) return v.toLowerCase();
  return undefined;
}

/** An E.164 phone with a plausible national-number length, or undefined.
 *  Rejects country-code-only ("+91") and merged/over-long numbers. */
export function validPhone(e164?: string | null): string | undefined {
  if (!e164) return undefined;
  const d = (e164.match(/\d/g) || []).length;
  if (d < 10 || d > 13) return undefined;
  return e164;
}

/** True only when the value looks like a real status label, not a boolean /
 *  numeric / NA token leaked from a Meeting/Site-Visit (TRUE/FALSE) column. */
export function looksLikeStatus(s?: string | null): boolean {
  if (!s) return false;
  const v = s.trim();
  if (!v) return false;
  if (/^(true|false|0|1|na|n\/a|#n\/a|null|nil|yes|no)$/i.test(v)) return false;
  return true;
}

/** True when a value is formatted like a DATE (19-Jun-26, 2026-06-19, 19/06/2026,
 *  "19 Jun 2026", ISO timestamp). Used to keep date values OUT of non-date fields
 *  (name / company / budget / city / address / configuration / BANT) — they belong
 *  only in date / follow-up / created columns. PURE NUMBERS are NOT dates, so a
 *  real numeric budget ("7000000") is never rejected. Defence-in-depth on top of
 *  the blank-header fix. */
export function looksLikeDate(s?: string | null): boolean {
  if (!s) return false;
  const v = s.trim();
  if (!v) return false;
  const M = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)";
  // dd-Mon-yy / dd Mon yyyy  (19-Jun-26, 19 Jun 2026)
  if (new RegExp(`^\\d{1,2}[-/. ]${M}[a-z]*[-/., ]+\\d{2,4}$`, "i").test(v)) return true;
  // Mon dd, yyyy  (Jun 19, 2026)
  if (new RegExp(`^${M}[a-z]*[-/. ]\\d{1,2}[-/., ]+\\d{2,4}$`, "i").test(v)) return true;
  // ISO 2026-06-19 (optionally with a clock time)
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{1,2}:\d{2})?/.test(v)) return true;
  // dd/mm/yyyy · dd-mm-yyyy · mm/dd/yy
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v)) return true;
  // embedded "dd Mon yyyy" timestamp within a short cell
  if (v.length < 40 && new RegExp(`\\b\\d{1,2}\\s+${M}[a-z]*\\s+\\d{2,4}\\b`, "i").test(v)) return true;
  return false;
}

/** A budget value only if it actually contains a number AND is not a date.
 *  "Lalit Sir" / "Tanuj" (digit-less) and "19-Jun-26" (a date) are rejected. */
export function validBudgetRaw(s?: string | null): string | undefined {
  if (!s) return undefined;
  const v = s.trim();
  if (!v || !/\d/.test(v)) return undefined;
  if (looksLikeDate(v)) return undefined;   // a date is never a budget
  return v;
}

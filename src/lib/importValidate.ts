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

/** A budget value only if it actually contains a number. "Lalit Sir",
 *  "Tanuj", and other digit-less text are rejected (never a budget). */
export function validBudgetRaw(s?: string | null): string | undefined {
  if (!s) return undefined;
  const v = s.trim();
  if (!v || !/\d/.test(v)) return undefined;
  return v;
}

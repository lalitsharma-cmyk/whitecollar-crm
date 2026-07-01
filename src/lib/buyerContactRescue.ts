// ────────────────────────────────────────────────────────────────────────────
// buyerContactRescue.ts — shared phone/email RESCUE for buyer imports.
//
// Extract contact values from a VERBATIM imported row by column-NAME pattern, so
// an unmapped header (e.g. "Primary Mobile Number") NEVER loses the phone/email.
// The import route uses it as a defense-in-depth fallback when the wizard's
// column-map missed the phone/email column; the backfill uses it to repair rows
// imported before the fix; the regression harness asserts it on real headers.
//
// PURE (no "server-only", no prisma) so it's importable everywhere + unit-testable.
//
// Patterns are DELIBERATELY tight: phones match mobile/phone/whatsapp/contact/
// cell/telephone but NEVER bare "number" (that would wrongly grab "Unit Number");
// emails match "e-mail" / "email". Collects EVERY phone-like column (primary +
// whatsapp + alternate) into one deduped array.
// ────────────────────────────────────────────────────────────────────────────

export const PHONE_COL = /(mobile|phone|whats\s*app|contact\s*(?:no\b|number|#)?|\bcell\b|telephone|\btel\b)/i;
export const EMAIL_COL = /e-?\s*mail/i;

export function rescuePhones(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!PHONE_COL.test(k)) continue;
    for (const p of String(v ?? "").split(/[,;|/]/)) {
      const t = p.trim();
      if (t && /\d/.test(t)) out.push(t); // must contain a digit
    }
  }
  return [...new Set(out)];
}

export function rescueEmails(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (!EMAIL_COL.test(k)) continue;
    for (const e of String(v ?? "").split(/[,;|/\s]+/)) {
      const t = e.trim().toLowerCase();
      if (t.includes("@")) out.push(t);
    }
  }
  return [...new Set(out)];
}

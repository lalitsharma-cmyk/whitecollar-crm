// ── Imported-field DISPLAY formatting ────────────────────────────────────────
// PURE, side-effect-free helper for the user-facing "Imported Fields" card
// (ImportedFieldsCard). Excel/Google-Sheets export date columns as *serial
// numbers* (days since the 1899-12-30 epoch), so a "FOLLOWUP DATE" column that
// read "25 Jun 2026" in the sheet lands in our customFields/extraFields JSON as
// the bare number 46198. Showing "46198" to the team is meaningless — this
// converts a plausible date-serial under a date-like key back to "DD MMM YYYY".
//
// SCOPE: this is a DISPLAY transform only. It is applied to the human-facing
// Imported Fields values. The raw imported row (rawImport) and the stored JSON
// are NEVER mutated — the verbatim import audit stays byte-for-byte intact.
//
// SAFETY: we NEVER touch a numeric that isn't a date. Budgets, prices, areas,
// phone/whatsapp numbers, pincodes, RERA/passport ids etc. are money/identifiers
// that merely look numeric — converting "46198" (a valid-looking serial) there
// would corrupt the display. So we (a) require the key to look date-like AND
// (b) hard-exclude any key that names a known numeric/identifier field, AND
// (c) require the number to sit in the plausible Excel-serial window.

// Excel/Sheets serial epoch. Excel's day 1 is 1900-01-01, but it also carries
// the fictional 1900-02-29 leap day, so the effective epoch that makes the
// arithmetic line up is 1899-12-30. serial N  ⇒  epoch + N days.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // 1899-12-30
const MS_PER_DAY = 86_400_000;

// Plausible Excel-serial window so we only ever convert numbers that really
// could be a date. 20000 ≈ 1954-10-03, 60000 ≈ 2064-03-16. A budget like 21000
// (₹) or an area of 1200 (sqft) sits outside or is guarded by key anyway; this
// band is the last line of defence for a date-like key holding a real number.
const SERIAL_MIN = 20_000;
const SERIAL_MAX = 60_000;

// Keys that (case-insensitively) mean "this is a date column". Either the key
// CONTAINS "date" (covers "Follow-up Date", "Booking Date", "Site Visit Date",
// "Created Date", "Meeting Date", "Visit Date", "DOB date" …) OR it exactly
// matches one of these bare labels that don't contain the word "date".
const DATE_LIKE_EXACT = new Set(
  [
    "follow-up date",
    "followup date",
    "follow up date",
    "date",
    "created date",
    "meeting date",
    "visit date",
    "site visit date",
    "booking date",
  ].map((s) => s.toLowerCase()),
);

// Keys that are numeric/identifier fields — NEVER date-convert these even if the
// value is a plausible serial. Substring match, case-insensitive.
const NON_DATE_NUMERIC = [
  "budget",
  "price",
  "amount",
  "value",
  "area",
  "sqft",
  "sq ft",
  "sq.ft",
  "size",
  "mobile",
  "phone",
  "whatsapp",
  "number",
  "pincode",
  "pin code",
  "rera",
  "passport",
];

/** Month abbreviations matching the CRM's "DD MMM YYYY" display (see datetime.ts). */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function keyIsDateLike(key: string): boolean {
  const k = key.trim().toLowerCase();
  if (!k) return false;
  if (/date/.test(k)) return true;
  return DATE_LIKE_EXACT.has(k);
}

function keyIsGuardedNumeric(key: string): boolean {
  const k = key.trim().toLowerCase();
  return NON_DATE_NUMERIC.some((needle) => k.includes(needle));
}

/**
 * Parse a value that is EITHER a JS number OR a pure-numeric string ("46198",
 * "46198.0") into that number. Anything else (blank, "25/06/2026", "N/A",
 * "2 BHK") returns null — we only serial-convert honest numerics.
 */
function asPlainNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const s = value.trim();
    // Pure integer/decimal only. Reject "25/06/2026", "1,200", "46198abc", "".
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Excel serial (days since 1899-12-30) → "DD MMM YYYY" in UTC, or null if the
 *  resulting date is somehow invalid. Uses UTC throughout so a whole-day serial
 *  never drifts across a timezone boundary (a date-only serial has no TZ). */
function excelSerialToReadable(serial: number): string | null {
  // Round to the whole day — a date-only column is an integer serial; a stray
  // fractional part (time-of-day) is discarded for the DD MMM YYYY display.
  const days = Math.round(serial);
  const ms = EXCEL_EPOCH_UTC + days * MS_PER_DAY;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mmm = MONTHS[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  if (!mmm) return null;
  return `${dd} ${mmm} ${yyyy}`;
}

/**
 * Format a single imported field value for the user-facing Imported Fields card.
 *
 *  • Date-like key + plausible Excel serial number → "DD MMM YYYY"
 *    e.g. formatImportedFieldValue("FOLLOWUP DATE", 46198) → "25 Jun 2026"
 *  • Guarded numeric key (budget/price/phone/…) → raw value, untouched
 *  • Everything else (already-readable strings, non-serial numbers) → String(value)
 *
 * PURE: no I/O, no mutation of `value`. Safe to call in server or client render.
 */
export function formatImportedFieldValue(key: string, value: unknown): string {
  if (value == null) return "";

  // Never convert money/identifier columns, even when the value is a valid serial.
  if (keyIsGuardedNumeric(key)) return String(value);

  if (keyIsDateLike(key)) {
    const n = asPlainNumber(value);
    if (n != null && n >= SERIAL_MIN && n <= SERIAL_MAX) {
      const readable = excelSerialToReadable(n);
      if (readable) return readable;
    }
    // Not a plausible serial (already "25 Jun 2026", a real string date, out of
    // range, or non-numeric) → leave it exactly as written.
    return String(value);
  }

  // Non-date key → verbatim.
  return String(value);
}

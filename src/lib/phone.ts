// Phone number utilities — used by the country-code picker (PhoneInput.tsx) and
// by every WhatsApp / call link generator.
//
// The big rule: store phones in E.164 format ("+<countrycode><digits>", no spaces).
// WhatsApp's wa.me / api.whatsapp.com endpoints REQUIRE this with no leading "+";
// the previous "strip non-digits and hope" approach silently broke for any number
// missing a country code (very common when agents type "050 123 4567").

export interface CountryDial {
  iso: string;        // "AE"
  name: string;       // "UAE"
  dial: string;       // "+971" — no spaces
  flag: string;       // 🇦🇪
}

// Curated list — full ITU list is 240+ entries; this is the 25 countries that
// matter for White Collar Realty's pipeline (Dubai + India + their NRI feeders).
export const COUNTRIES: CountryDial[] = [
  { iso: "AE", name: "UAE",            dial: "+971", flag: "🇦🇪" },
  { iso: "IN", name: "India",          dial: "+91",  flag: "🇮🇳" },
  { iso: "GB", name: "UK",             dial: "+44",  flag: "🇬🇧" },
  { iso: "US", name: "USA",            dial: "+1",   flag: "🇺🇸" },
  { iso: "CA", name: "Canada",         dial: "+1",   flag: "🇨🇦" },
  { iso: "SG", name: "Singapore",      dial: "+65",  flag: "🇸🇬" },
  { iso: "SA", name: "Saudi Arabia",   dial: "+966", flag: "🇸🇦" },
  { iso: "QA", name: "Qatar",          dial: "+974", flag: "🇶🇦" },
  { iso: "KW", name: "Kuwait",         dial: "+965", flag: "🇰🇼" },
  { iso: "BH", name: "Bahrain",        dial: "+973", flag: "🇧🇭" },
  { iso: "OM", name: "Oman",           dial: "+968", flag: "🇴🇲" },
  { iso: "EG", name: "Egypt",          dial: "+20",  flag: "🇪🇬" },
  { iso: "PK", name: "Pakistan",       dial: "+92",  flag: "🇵🇰" },
  { iso: "BD", name: "Bangladesh",     dial: "+880", flag: "🇧🇩" },
  { iso: "LK", name: "Sri Lanka",      dial: "+94",  flag: "🇱🇰" },
  { iso: "NP", name: "Nepal",          dial: "+977", flag: "🇳🇵" },
  { iso: "PH", name: "Philippines",    dial: "+63",  flag: "🇵🇭" },
  { iso: "ZA", name: "South Africa",   dial: "+27",  flag: "🇿🇦" },
  { iso: "KE", name: "Kenya",          dial: "+254", flag: "🇰🇪" },
  { iso: "NG", name: "Nigeria",        dial: "+234", flag: "🇳🇬" },
  { iso: "AU", name: "Australia",      dial: "+61",  flag: "🇦🇺" },
  { iso: "FR", name: "France",         dial: "+33",  flag: "🇫🇷" },
  { iso: "DE", name: "Germany",        dial: "+49",  flag: "🇩🇪" },
  { iso: "RU", name: "Russia",         dial: "+7",   flag: "🇷🇺" },
  { iso: "CN", name: "China",          dial: "+86",  flag: "🇨🇳" },
];

/** Default country for an agent's team — used to pre-select the dial picker.
 *  Lalit: "In number, IN should be by default selected." Most of the team
 *  works the India pipeline so +91 is the safer global default. Dubai team's
 *  PhoneInput still gets +971 when an explicit defaultDial="+971" is passed in
 *  by the parent (e.g. on the Dubai-team intake form). */
export function defaultDialForTeam(team?: string | null): string {
  if (team === "Dubai" || team === "UAE") return "+971";
  return "+91"; // India default for everything else
}

/**
 * Normalises any phone-shaped string to canonical E.164 with leading "+".
 * Returns null if input is unusable.
 *
 *   "+971 50 123 4567"  → "+971501234567"
 *   "00971 50 1234567"  → "+971501234567"
 *   "0501234567" + "+971" → "+971501234567"  (strips local leading 0)
 *   "501234567" + "+971" → "+971501234567"
 */
export function toE164(raw: string | null | undefined, fallbackDial?: string): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // 00 → +
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // Pull digits, preserve leading +
  const hasPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (hasPlus) return "+" + s;
  // No country code given — prepend fallback
  if (!fallbackDial) {
    // No explicit hint — try to infer country from the digit shape itself.
    // Lalit's rule: team is NOT a phone-country signal, so when the Google-Sheet
    // route forwards a bare "9876543210" we still need to land on +91, not +98…
    //
    //   10-digit starting 6/7/8/9  → India mobile     → +91
    //   9-digit  starting 5        → UAE mobile       → +971
    //   10-digit starting 0        → strip leading 0, re-test above
    //   anything else              → "+" + digits (best-effort, unchanged)
    let t = s;
    if (t.length === 10 && t.startsWith("0")) t = t.slice(1);
    if (t.length === 10 && /^[6-9]/.test(t)) return "+91" + t;
    if (t.length === 9 && t.startsWith("5")) return "+971" + t;
    return "+" + s; // best-effort
  }
  const dialDigits = fallbackDial.replace(/\D/g, "");
  // If the number already starts with the country code AND total length matches
  // a real number for that country, don't double-prefix.
  //   India (+91): 12 digits total (91 + 10-digit mobile)
  //   UAE  (+971): 12 digits total (971 + 9-digit mobile)
  //   Generic fallback: 11+ digits when stripped of country code is still 9+
  const expectedLen = dialDigits === "91" ? 12 : dialDigits === "971" ? 12 : dialDigits.length + 8;
  if (s.startsWith(dialDigits) && s.length >= expectedLen) return "+" + s;
  // Strip a local-trunk leading zero (common in IN/AE/UK)
  if (s.startsWith("0")) s = s.replace(/^0+/, "");
  return "+" + dialDigits + s;
}

/**
 * Splits a raw phone cell that may contain MULTIPLE numbers and normalises each.
 *
 * MIS / Excel cells frequently look like:
 *   "+919146449146, 7779990838"        ← India primary + alt
 *   "+91 98765 43210 / 9123456789"     ← slash separator
 *   "+971501234567;+971559876543"      ← semicolon
 *   "+91 98765 43210\n+91 91234 56789" ← newline inside cell
 *
 * Without splitting, `toE164` strips every non-digit and concatenates both into
 * one impossibly-long fake number (the original bug Lalit spotted: a 22-digit
 * "phone" got stored when two real numbers were comma-separated).
 *
 * Returns an array of E.164-normalised strings, de-duplicated, in input order.
 * Empty array if nothing usable.
 */
export function splitPhones(raw: string | null | undefined, fallbackDial?: string): string[] {
  if (!raw) return [];
  // Split on common separators. A bare space is intentionally NOT a separator
  // because numbers like "+91 98765 43210" use spaces internally.
  // Heuristic for "+ followed by digits with spaces" sticks together; comma/
  // semicolon/slash/newline/pipe split. " and " / " & " also split.
  const parts = String(raw)
    .split(/[,;|/\n\r]+|\s+(?:and|&)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const e = toE164(p, fallbackDial);
    if (!e) continue;
    // De-dupe (same number written two ways in the same cell)
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** Extracts just the WhatsApp-ready digits (no leading +, no spaces). */
export function whatsappDigits(e164OrAny: string | null | undefined, fallbackDial?: string): string | null {
  const e = toE164(e164OrAny, fallbackDial);
  if (!e) return null;
  return e.replace(/^\+/, "");
}

/**
 * Builds a WhatsApp deep-link.
 *
 * Uses api.whatsapp.com/send instead of wa.me — empirically more reliable on
 * mobile when the number was entered without spaces or when the user has
 * WhatsApp Business installed (the wa.me redirect sometimes fails).
 */
export function whatsappLink(phone: string | null | undefined, message?: string, fallbackDial?: string): string {
  const digits = whatsappDigits(phone, fallbackDial);
  if (!digits) return "";
  const base = `https://api.whatsapp.com/send?phone=${digits}`;
  return message ? `${base}&text=${encodeURIComponent(message)}` : base;
}

/** Builds a tel: URL — strips spaces but keeps + and digits. */
export function telLink(phone: string | null | undefined, fallbackDial?: string): string {
  const e = toE164(phone, fallbackDial);
  return e ? `tel:${e}` : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizePhone — canonical E.164 for deduplication (B-01 dedup groundwork)
// ─────────────────────────────────────────────────────────────────────────────
//
// HOUSE RULES:
//   1. If digits already carry an explicit country code (971… or 91…), RESPECT IT.
//      Do NOT override a +971 number just because defaultCountry="IN" was passed.
//   2. defaultCountry is ONLY applied when no country code can be inferred from
//      the digit string itself. Never infer from team name, geography, or any
//      signal other than the digits and this explicit param.
//   3. Return canonical "+<digits>" (E.164) or null if the input can't be a
//      valid phone number (empty, too short, all punctuation, …).
//
// WORKED EXAMPLES:
//   normalizePhone("+91 98765 43210")                     → "+919876543210"
//   normalizePhone("9876543210", "IN")                    → "+919876543210"
//   normalizePhone("09876543210", "IN")                   → "+919876543210"  (strips leading 0)
//   normalizePhone("+971 50 123 4567")                    → "+971501234567"
//   normalizePhone("0501234567", "AE")                    → "+971501234567"  (UAE local + strip 0)
//   normalizePhone("  junk !!  ")                         → null
//   normalizePhone("+971501234567")                       → "+971501234567"  (already canonical)
//   normalizePhone("971501234567")                        → "+971501234567"  (detects 971 prefix)
//
// NOTE: this is a PURE function — no Prisma, no side effects.
export function normalizePhone(
  raw: string,
  defaultCountry?: "AE" | "IN",
): string | null {
  if (!raw) return null;

  let s = raw.trim();
  if (!s) return null;

  // 1. Convert "00…" international prefix to "+"
  if (s.startsWith("00")) s = "+" + s.slice(2);

  const hadPlus = s.startsWith("+");

  // 2. Strip everything that isn't a digit
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;

  // 3. If input carried a "+" the caller explicitly included the country code —
  //    trust it completely (rule #1).
  if (hadPlus) {
    // Sanity: E.164 is 7–15 digits (ITU-T E.164 §3.2)
    if (digits.length < 7 || digits.length > 15) return null;
    return "+" + digits;
  }

  // 4. No leading "+": try to detect whether a country code is already embedded
  //    in the digit string, so we never double-prefix (rule #1).
  //
  //    Heuristics (ordered by specificity — longest prefix wins):
  //      a. 12-digit string starting with "971" → UAE E.164 (971 + 9-digit mobile)
  //      b. 12-digit string starting with "91"  → India E.164 (91 + 10-digit mobile)
  //
  //    These are the only two country codes this CRM deals with in the ambiguous
  //    un-prefixed-plus path. All other countries are left for the defaultCountry
  //    fallback or returned best-effort.

  // UAE: 971 + 9 subscriber digits = 12 total
  if (digits.length === 12 && digits.startsWith("971")) {
    return "+" + digits;
  }
  // India: 91 + 10 subscriber digits = 12 total
  if (digits.length === 12 && digits.startsWith("91")) {
    return "+" + digits;
  }

  // 5. No embedded country code detected — now apply defaultCountry (rule #2).
  if (defaultCountry === "IN") {
    // Indian mobile numbers are exactly 10 digits, starting 6–9.
    // Accept 11-digit if leading "0" (trunk prefix), strip it.
    let local = digits;
    if (local.length === 11 && local.startsWith("0")) local = local.slice(1);
    if (local.length === 10 && /^[6-9]/.test(local)) return "+91" + local;
    // Doesn't look like an Indian mobile — fall through to best-effort.
  }

  if (defaultCountry === "AE") {
    // UAE mobile numbers are 9 digits (e.g. 501234567).
    // Accept 10-digit if leading "0" (local trunk), strip it.
    let local = digits;
    if (local.length === 10 && local.startsWith("0")) local = local.slice(1);
    if (local.length === 9 && local.startsWith("5")) return "+971" + local;
    // Doesn't look like a UAE mobile — fall through.
  }

  // 6. No defaultCountry supplied or digit shape didn't fit the expected pattern.
  //    Use the same shape-inference as toE164() so bare 10-digit Indian numbers
  //    still get +91 even when the caller didn't specify defaultCountry.
  //    This mirrors the existing ingestLead() behaviour for Google-Sheet imports.
  let t = digits;
  if (t.length === 11 && t.startsWith("0")) t = t.slice(1);
  if (t.length === 10 && /^[6-9]/.test(t)) return "+91" + t;
  if (t.length === 9 && t.startsWith("5")) return "+971" + t;

  // 7. Nothing matched — return best-effort E.164 if the digit count is in
  //    the valid ITU-T range (7–15), otherwise null.
  if (digits.length >= 7 && digits.length <= 15) return "+" + digits;
  return null;
}

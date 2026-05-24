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

/** Default country for an agent's team — used to pre-select the dial picker. */
export function defaultDialForTeam(team?: string | null): string {
  if (team === "India") return "+91";
  return "+971"; // Dubai default
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
  if (!fallbackDial) return "+" + s; // best-effort
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

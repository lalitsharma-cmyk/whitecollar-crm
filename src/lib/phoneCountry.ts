// ─────────────────────────────────────────────────────────────────────────────
// Phone → country canonicalization + nationality inference (Dubai Buyer import, Req 6).
//
//   • nationalityFromPhone("447912345678") → "United Kingdom"  (PREFIX only)
//   • canonicalizePhone("501234567", "UAE") → "+971501234567"  (bare local + hint)
//   • canonicalizePhone("447912345678")     → "+447912345678"  (already has CC)
//
// Prefix-only matching (never middle/end digits). Normalization: strip non-digits,
// drop a leading "+" or "00", and canonicalize the UK national trunk (07… → 447…),
// mirroring scripts/backfill-dubai-buyer-nationality.ts so import + backfill agree.
// NOTE: buyer dedup already matches by the last-8 phone tail, so +447… and 447…
// already collapse to one record — this adds clean +CC storage + blank-nationality fill.
// ─────────────────────────────────────────────────────────────────────────────

// Country calling code → nationality label. Longest-prefix wins (see below), so the
// 3-digit codes are checked before the 2- and 1-digit ones. Focused on the Dubai
// market's common origins; extend as needed.
const CC_TO_NATIONALITY: Array<[string, string]> = [
  ["971", "United Arab Emirates"], ["966", "Saudi Arabia"], ["974", "Qatar"],
  ["973", "Bahrain"], ["968", "Oman"], ["965", "Kuwait"], ["880", "Bangladesh"],
  ["852", "Hong Kong"], ["234", "Nigeria"], ["353", "Ireland"], ["351", "Portugal"],
  ["380", "Ukraine"], ["386", "Slovenia"], ["known3", ""], // sentinel (ignored)
  ["44", "United Kingdom"], ["65", "Singapore"], ["91", "India"], ["92", "Pakistan"],
  ["61", "Australia"], ["64", "New Zealand"], ["27", "South Africa"], ["20", "Egypt"],
  ["49", "Germany"], ["33", "France"], ["39", "Italy"], ["34", "Spain"], ["31", "Netherlands"],
  ["41", "Switzerland"], ["46", "Sweden"], ["47", "Norway"], ["45", "Denmark"], ["32", "Belgium"],
  ["43", "Austria"], ["48", "Poland"], ["90", "Turkey"], ["98", "Iran"], ["94", "Sri Lanka"],
  ["60", "Malaysia"], ["62", "Indonesia"], ["63", "Philippines"], ["66", "Thailand"], ["84", "Vietnam"],
  ["82", "South Korea"], ["81", "Japan"], ["86", "China"], ["7", "Russia"], ["1", "United States"],
];

// Nationality (as written on a sheet, loosely) → country calling code, for the
// "bare local number + nationality provided" case (e.g. UAE 501234567 → +971501234567).
const NATIONALITY_TO_CC: Record<string, string> = {
  "uae": "971", "united arab emirates": "971", "emirati": "971", "emirates": "971", "dubai": "971", "abu dhabi": "971",
  "uk": "44", "united kingdom": "44", "british": "44", "britain": "44", "england": "44", "scotland": "44", "wales": "44", "gb": "44",
  "singapore": "65", "singaporean": "65", "india": "91", "indian": "91", "pakistan": "92", "pakistani": "92",
  "saudi": "966", "saudi arabia": "966", "ksa": "966", "qatar": "974", "qatari": "974", "bahrain": "973", "oman": "968", "omani": "968",
  "kuwait": "965", "kuwaiti": "965", "usa": "1", "us": "1", "united states": "1", "american": "1", "canada": "1",
  "australia": "61", "australian": "61", "egypt": "20", "egyptian": "20", "nigeria": "234", "nigerian": "234",
  "philippines": "63", "filipino": "63", "china": "86", "chinese": "86", "russia": "7", "russian": "7",
};

/** digits-only, drop a leading "+"/"00", canonicalize UK 0-trunk mobile (07… → 447…). */
export function normalizeDigits(raw: string | null | undefined): string {
  let s = String(raw ?? "").replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (/^07\d{9}$/.test(s)) s = "44" + s.slice(1);
  return s;
}

/** Nationality inferred from a phone's country-code PREFIX, or null. Longest CC wins. */
export function nationalityFromPhone(raw: string | null | undefined): string | null {
  const s = normalizeDigits(raw);
  if (s.length < 8) return null; // too short to carry a country code + subscriber number
  let best: [string, string] | null = null;
  for (const [cc, nat] of CC_TO_NATIONALITY) {
    if (!nat) continue;
    if (s.startsWith(cc) && (!best || cc.length > best[0].length)) best = [cc, nat];
  }
  return best ? best[1] : null;
}

/** Canonical "+CC…" phone. Uses the phone's own country code when present; otherwise,
 *  for a bare local number, uses the nationality hint's code (stripping a trunk 0). */
export function canonicalizePhone(raw: string | null | undefined, nationalityHint?: string | null): string {
  const original = String(raw ?? "").trim();
  const s = normalizeDigits(raw);
  if (!s) return original;
  // Already carries a recognizable country code → just prefix "+".
  if (nationalityFromPhone(s)) return "+" + s;
  // Bare local number + a nationality we can map → prepend that country code.
  const hint = (nationalityHint ?? "").trim().toLowerCase();
  const cc = NATIONALITY_TO_CC[hint];
  if (cc) return "+" + cc + s.replace(/^0+/, "");
  // Unknown — return the original (never guess a country code we can't justify).
  return original;
}

/**
 * §17 — City → Country auto-fill.
 * When a lead has a city but no country, infer the country automatically.
 * Used at lead-create/update time and for the one-time historical backfill.
 */

const CITY_COUNTRY: Record<string, string> = {
  // India
  delhi: "India", "new delhi": "India",
  gurgaon: "India", gurugram: "India",
  noida: "India", "greater noida": "India",
  faridabad: "India", manesar: "India",
  ghaziabad: "India",
  mumbai: "India", "navi mumbai": "India", thane: "India", pune: "India",
  bangalore: "India", bengaluru: "India",
  hyderabad: "India", secunderabad: "India",
  chennai: "India", coimbatore: "India",
  kolkata: "India",
  ahmedabad: "India", surat: "India", vadodara: "India",
  jaipur: "India", jodhpur: "India", udaipur: "India",
  lucknow: "India", kanpur: "India", agra: "India",
  chandigarh: "India", mohali: "India", panchkula: "India",
  indore: "India", bhopal: "India", nagpur: "India",
  goa: "India", panaji: "India",
  kochi: "India", thiruvananthapuram: "India",
  bhubaneswar: "India", patna: "India", ranchi: "India",
  dehradun: "India", shimla: "India",
  srinagar: "India", jammu: "India",
  amritsar: "India", ludhiana: "India",
  // UAE
  dubai: "UAE",
  "abu dhabi": "UAE", abudhabi: "UAE",
  sharjah: "UAE",
  ajman: "UAE",
  "ras al khaimah": "UAE", rak: "UAE", rasalkhaimah: "UAE",
  fujairah: "UAE",
  "umm al quwain": "UAE",
  // UK
  london: "UK", manchester: "UK", birmingham: "UK",
  // USA
  "new york": "USA", "los angeles": "USA", "san francisco": "USA", chicago: "USA",
  // Singapore
  singapore: "Singapore",
  // Australia
  sydney: "Australia", melbourne: "Australia",
  // Canada
  toronto: "Canada", vancouver: "Canada",
};

/**
 * Given a city string, return the likely country.
 * Returns null if the city is unknown.
 */
export function inferCountryFromCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.toLowerCase().trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z ]/g, "");
  return CITY_COUNTRY[key] ?? null;
}

// Fuzzy DISPLAY fallback. Real city strings are messy — "DELHI AND NCR",
// "Defence colony, Delhi", "GK1, Delhi", "Dubai Marina" — and won't exact-match
// the map above. Scan for the major metros as substrings (UAE first so a string
// containing "dubai" wins). RENDER-TIME ONLY — this never writes to the DB.
const INDIA_CITY_HINTS = ["delhi", "ncr", "gurgaon", "gurugram", "noida", "pune", "bangalore", "bengaluru", "mumbai", "ghaziabad", "faridabad"];
const UAE_CITY_HINTS = ["dubai", "abu dhabi", "abudhabi", "ras al khaimah", "sharjah", "ajman"];
export function inferCountryFromCityFuzzy(city: string | null | undefined): string | null {
  const exact = inferCountryFromCity(city);
  if (exact) return exact;
  if (!city) return null;
  const c = city.toLowerCase();
  if (UAE_CITY_HINTS.some((h) => c.includes(h))) return "UAE";
  if (INDIA_CITY_HINTS.some((h) => c.includes(h))) return "India";
  return null;
}

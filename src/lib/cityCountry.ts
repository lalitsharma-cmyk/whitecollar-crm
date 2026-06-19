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
  // Turkey (Dubai Property Expo draws Turkish investors — Istanbul etc.)
  istanbul: "Turkey", ankara: "Turkey", izmir: "Turkey", antalya: "Turkey",
  bursa: "Turkey", adana: "Turkey", gaziantep: "Turkey", konya: "Turkey",
  // Other GCC (common cross-border buyers at Dubai events)
  riyadh: "Saudi Arabia", jeddah: "Saudi Arabia", dammam: "Saudi Arabia",
  doha: "Qatar", muscat: "Oman", "kuwait city": "Kuwait", kuwait: "Kuwait",
  manama: "Bahrain",
  // UK
  london: "UK", manchester: "UK", birmingham: "UK", leeds: "UK", glasgow: "UK",
  // USA
  "new york": "USA", "los angeles": "USA", "san francisco": "USA", chicago: "USA", houston: "USA",
  // Singapore
  singapore: "Singapore",
  // Australia
  sydney: "Australia", melbourne: "Australia", perth: "Australia",
  // Canada
  toronto: "Canada", vancouver: "Canada", calgary: "Canada",
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
const INDIA_CITY_HINTS = [
  "delhi", "ncr", "gurgaon", "gurugram", "noida", "pune", "bangalore", "bengaluru",
  "mumbai", "ghaziabad", "faridabad", "manesar", "sohna",
  // Gurgaon / Delhi-NCR neighbourhood + sector patterns common in our data
  "sector", "sec-", "sec ", "dlf", "sushant", "cyber", "golf course", "udyog vihar",
  "palam vihar", "nirvana", "south city", "mg road", "rohini", "dwarka", "saket",
  "vasant", "janakpuri", "pitampura", "rajouri", "lajpat", "greater kailash",
];
const UAE_CITY_HINTS = [
  "dubai", "abu dhabi", "abudhabi", "ras al khaimah", "sharjah", "ajman", "fujairah",
  // Dubai community / area names that appear as the "city" on event leads
  "marina", "jumeirah", "jvc", "jbr", "business bay", "downtown dubai", "deira",
  "bur dubai", "sheikh zayed", "silicon oasis", "international city", "motor city",
  "sports city", "al barsha", "tecom", "difc", "damac hills", "dubai hills",
];
const TURKEY_CITY_HINTS = ["istanbul", "ankara", "izmir", "antalya", "bursa"];
export function inferCountryFromCityFuzzy(city: string | null | undefined): string | null {
  const exact = inferCountryFromCity(city);
  if (exact) return exact;
  if (!city) return null;
  const c = city.toLowerCase();
  if (UAE_CITY_HINTS.some((h) => c.includes(h))) return "UAE";
  if (INDIA_CITY_HINTS.some((h) => c.includes(h))) return "India";
  if (TURKEY_CITY_HINTS.some((h) => c.includes(h))) return "Turkey";
  return null;
}

// Normalize a free-text / Nominatim country name to the CRM's canonical short
// form so curated and API-enriched leads never split into "UAE" vs "United Arab
// Emirates" variants (global data-consistency rule). Unknown names pass through.
const COUNTRY_CANON: Record<string, string> = {
  "united arab emirates": "UAE", "u.a.e.": "UAE", uae: "UAE",
  "united kingdom": "UK", "great britain": "UK", uk: "UK", england: "UK",
  "türkiye": "Turkey", turkiye: "Turkey", turkey: "Turkey",
  "united states": "USA", "united states of america": "USA", usa: "USA",
  "kingdom of saudi arabia": "Saudi Arabia", "saudi arabia": "Saudi Arabia",
  india: "India", qatar: "Qatar", oman: "Oman", kuwait: "Kuwait",
  bahrain: "Bahrain", singapore: "Singapore", australia: "Australia", canada: "Canada",
};
export function canonicalCountry(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim();
  return COUNTRY_CANON[t.toLowerCase()] ?? t;
}

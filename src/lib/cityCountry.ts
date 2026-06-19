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
  // UK — canonical form is "United Kingdom" (matches the owner's wording + the
  // majority of existing data; avoids a "UK" vs "United Kingdom" split).
  london: "United Kingdom", manchester: "United Kingdom", birmingham: "United Kingdom",
  leeds: "United Kingdom", glasgow: "United Kingdom",
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

// City → State / Province (parallel to CITY_COUNTRY). India = state, UAE = emirate,
// Turkey = province, etc. Auto-fills the State field alongside Country.
const CITY_STATE: Record<string, string> = {
  // India
  delhi: "Delhi", "new delhi": "Delhi",
  gurgaon: "Haryana", gurugram: "Haryana", faridabad: "Haryana", manesar: "Haryana", panchkula: "Haryana",
  noida: "Uttar Pradesh", "greater noida": "Uttar Pradesh", ghaziabad: "Uttar Pradesh",
  lucknow: "Uttar Pradesh", kanpur: "Uttar Pradesh", agra: "Uttar Pradesh",
  mumbai: "Maharashtra", "navi mumbai": "Maharashtra", thane: "Maharashtra", pune: "Maharashtra", nagpur: "Maharashtra",
  bangalore: "Karnataka", bengaluru: "Karnataka",
  hyderabad: "Telangana", secunderabad: "Telangana",
  chennai: "Tamil Nadu", coimbatore: "Tamil Nadu",
  kolkata: "West Bengal",
  ahmedabad: "Gujarat", surat: "Gujarat", vadodara: "Gujarat",
  jaipur: "Rajasthan", jodhpur: "Rajasthan", udaipur: "Rajasthan",
  chandigarh: "Chandigarh",
  mohali: "Punjab", amritsar: "Punjab", ludhiana: "Punjab",
  indore: "Madhya Pradesh", bhopal: "Madhya Pradesh",
  goa: "Goa", panaji: "Goa",
  kochi: "Kerala", thiruvananthapuram: "Kerala",
  bhubaneswar: "Odisha", patna: "Bihar", ranchi: "Jharkhand",
  dehradun: "Uttarakhand", shimla: "Himachal Pradesh",
  srinagar: "Jammu & Kashmir", jammu: "Jammu & Kashmir",
  // UAE (emirate)
  dubai: "Dubai", "abu dhabi": "Abu Dhabi", abudhabi: "Abu Dhabi", sharjah: "Sharjah",
  ajman: "Ajman", "ras al khaimah": "Ras Al Khaimah", rak: "Ras Al Khaimah", rasalkhaimah: "Ras Al Khaimah",
  fujairah: "Fujairah", "umm al quwain": "Umm Al Quwain",
  // Turkey (province)
  istanbul: "Istanbul", ankara: "Ankara", izmir: "Izmir", antalya: "Antalya",
  bursa: "Bursa", adana: "Adana", gaziantep: "Gaziantep", konya: "Konya",
  // GCC
  riyadh: "Riyadh", jeddah: "Makkah", dammam: "Eastern Province",
  doha: "Doha", muscat: "Muscat", "kuwait city": "Al Asimah",
  // UK
  london: "England", manchester: "England", birmingham: "England", leeds: "England", glasgow: "Scotland",
  // USA
  "new york": "New York", "los angeles": "California", "san francisco": "California", chicago: "Illinois", houston: "Texas",
  // Australia
  sydney: "New South Wales", melbourne: "Victoria", perth: "Western Australia",
  // Canada
  toronto: "Ontario", vancouver: "British Columbia", calgary: "Alberta",
};

/** City → State/Province (exact curated match). Null if unknown. */
export function inferStateFromCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z ]/g, "");
  return CITY_STATE[key] ?? null;
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
  "united kingdom": "United Kingdom", "great britain": "United Kingdom", uk: "United Kingdom",
  "u.k.": "United Kingdom", britain: "United Kingdom", england: "United Kingdom",
  "united kindon": "United Kingdom", "united kindom": "United Kingdom", "uniter kingdom": "United Kingdom",
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

// Curated Country → State/Province → City dataset for the cascading location
// picker (LocationSelect.tsx) used on the New-Lead form for both the customer
// address block AND the WCR-Event location block.
//
// SCOPE / PHILOSOPHY
//   • India is FULLY covered (all 28 states + 8 UTs, each with its key cities) —
//     the bulk of the pipeline is Indian buyers, so India must work end-to-end.
//   • UAE (emirates) + the common NRI feeder markets (UK, USA, Saudi, Qatar,
//     Singapore, Canada, Australia, Turkey, etc.) get lighter coverage — enough
//     that the dropdown is useful, with free-typing always allowed for the rest.
//   • This is a PURE static module (no Prisma, no server-only) so it can be
//     imported by a "use client" component and bundled safely.
//
// MANUAL ENTRY: the LocationSelect component renders every field as a datalist
// (suggestions + free typing), so an unknown country/state/city can always be
// typed even when it isn't in this map.
//
// Country names use the CRM canonical short forms (UAE, USA, United Kingdom)
// to stay consistent with cityCountry.ts / canonicalCountry().

export interface CountryData {
  /** Canonical display name, e.g. "India", "UAE". */
  name: string;
  /** State/Province/Emirate → list of key cities. */
  states: Record<string, string[]>;
}

// ── India: complete states + UTs, key cities each ───────────────────────────
const INDIA_STATES: Record<string, string[]> = {
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Tirupati", "Kurnool", "Rajahmundry", "Kakinada"],
  "Arunachal Pradesh": ["Itanagar", "Naharlagun", "Pasighat"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia"],
  "Bihar": ["Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia"],
  "Chhattisgarh": ["Raipur", "Bhilai", "Bilaspur", "Korba", "Durg"],
  "Goa": ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar", "Gandhinagar", "Junagadh"],
  "Haryana": ["Gurgaon", "Faridabad", "Manesar", "Panchkula", "Panipat", "Karnal", "Ambala", "Hisar", "Rohtak", "Sonipat"],
  "Himachal Pradesh": ["Shimla", "Manali", "Dharamshala", "Solan", "Mandi", "Kullu"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh"],
  "Karnataka": ["Bangalore", "Mysore", "Mangalore", "Hubli", "Belgaum", "Gulbarga", "Davanagere"],
  "Kerala": ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur", "Kollam", "Kannur", "Kottayam"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain", "Sagar"],
  "Maharashtra": ["Mumbai", "Navi Mumbai", "Thane", "Pune", "Nagpur", "Nashik", "Aurangabad", "Solapur", "Kolhapur"],
  "Manipur": ["Imphal", "Thoubal"],
  "Meghalaya": ["Shillong", "Tura"],
  "Mizoram": ["Aizawl", "Lunglei"],
  "Nagaland": ["Kohima", "Dimapur"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur"],
  "Punjab": ["Mohali", "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Pathankot"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Ajmer", "Bikaner", "Bhilwara"],
  "Sikkim": ["Gangtok", "Namchi"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli", "Vellore"],
  "Telangana": ["Hyderabad", "Secunderabad", "Warangal", "Nizamabad", "Karimnagar"],
  "Tripura": ["Agartala", "Udaipur"],
  "Uttar Pradesh": ["Noida", "Greater Noida", "Ghaziabad", "Lucknow", "Kanpur", "Agra", "Varanasi", "Meerut", "Allahabad", "Bareilly"],
  "Uttarakhand": ["Dehradun", "Haridwar", "Rishikesh", "Nainital", "Haldwani", "Roorkee"],
  "West Bengal": ["Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri"],
  // Union Territories
  "Delhi": ["New Delhi", "Delhi", "Dwarka", "Rohini", "Saket", "Janakpuri"],
  "Chandigarh": ["Chandigarh"],
  "Jammu & Kashmir": ["Srinagar", "Jammu"],
  "Ladakh": ["Leh", "Kargil"],
  "Puducherry": ["Puducherry", "Karaikal"],
  "Andaman & Nicobar Islands": ["Port Blair"],
  "Dadra & Nagar Haveli and Daman & Diu": ["Daman", "Silvassa", "Diu"],
  "Lakshadweep": ["Kavaratti"],
};

const UAE_STATES: Record<string, string[]> = {
  "Dubai": ["Dubai", "Jumeirah", "Dubai Marina", "Downtown Dubai", "Business Bay", "Deira", "Bur Dubai", "JVC", "Dubai Hills"],
  "Abu Dhabi": ["Abu Dhabi", "Al Ain", "Yas Island", "Saadiyat Island"],
  "Sharjah": ["Sharjah"],
  "Ajman": ["Ajman"],
  "Ras Al Khaimah": ["Ras Al Khaimah"],
  "Fujairah": ["Fujairah"],
  "Umm Al Quwain": ["Umm Al Quwain"],
};

const UK_STATES: Record<string, string[]> = {
  "England": ["London", "Manchester", "Birmingham", "Leeds", "Liverpool", "Bristol", "Leicester"],
  "Scotland": ["Glasgow", "Edinburgh", "Aberdeen"],
  "Wales": ["Cardiff", "Swansea"],
  "Northern Ireland": ["Belfast"],
};

const USA_STATES: Record<string, string[]> = {
  "California": ["Los Angeles", "San Francisco", "San Diego", "San Jose"],
  "New York": ["New York", "Buffalo"],
  "Texas": ["Houston", "Dallas", "Austin", "San Antonio"],
  "New Jersey": ["Jersey City", "Newark", "Edison"],
  "Illinois": ["Chicago"],
  "Florida": ["Miami", "Orlando", "Tampa"],
  "Washington": ["Seattle"],
  "Georgia": ["Atlanta"],
};

const CANADA_STATES: Record<string, string[]> = {
  "Ontario": ["Toronto", "Ottawa", "Mississauga", "Brampton"],
  "British Columbia": ["Vancouver", "Surrey", "Burnaby"],
  "Alberta": ["Calgary", "Edmonton"],
  "Quebec": ["Montreal"],
};

const SAUDI_STATES: Record<string, string[]> = {
  "Riyadh": ["Riyadh"],
  "Makkah": ["Jeddah", "Mecca"],
  "Eastern Province": ["Dammam", "Khobar", "Dhahran"],
};

const TURKEY_STATES: Record<string, string[]> = {
  "Istanbul": ["Istanbul"],
  "Ankara": ["Ankara"],
  "Izmir": ["Izmir"],
  "Antalya": ["Antalya"],
  "Bursa": ["Bursa"],
};

const AUSTRALIA_STATES: Record<string, string[]> = {
  "New South Wales": ["Sydney", "Newcastle"],
  "Victoria": ["Melbourne", "Geelong"],
  "Queensland": ["Brisbane", "Gold Coast"],
  "Western Australia": ["Perth"],
};

const SINGAPORE_STATES: Record<string, string[]> = {
  "Singapore": ["Singapore"],
};

const QATAR_STATES: Record<string, string[]> = {
  "Doha": ["Doha"],
  "Al Rayyan": ["Al Rayyan"],
};

const OMAN_STATES: Record<string, string[]> = {
  "Muscat": ["Muscat"],
  "Dhofar": ["Salalah"],
};

const KUWAIT_STATES: Record<string, string[]> = {
  "Al Asimah": ["Kuwait City"],
  "Hawalli": ["Hawalli"],
};

const BAHRAIN_STATES: Record<string, string[]> = {
  "Capital": ["Manama"],
  "Muharraq": ["Muharraq"],
};

// Ordered so the most-relevant markets surface first in the country dropdown.
export const COUNTRIES_DATA: CountryData[] = [
  { name: "India", states: INDIA_STATES },
  { name: "UAE", states: UAE_STATES },
  { name: "United Kingdom", states: UK_STATES },
  { name: "USA", states: USA_STATES },
  { name: "Canada", states: CANADA_STATES },
  { name: "Saudi Arabia", states: SAUDI_STATES },
  { name: "Qatar", states: QATAR_STATES },
  { name: "Oman", states: OMAN_STATES },
  { name: "Kuwait", states: KUWAIT_STATES },
  { name: "Bahrain", states: BAHRAIN_STATES },
  { name: "Singapore", states: SINGAPORE_STATES },
  { name: "Turkey", states: TURKEY_STATES },
  { name: "Australia", states: AUSTRALIA_STATES },
];

/** All country names, in pipeline-priority order. */
export const COUNTRY_NAMES: string[] = COUNTRIES_DATA.map((c) => c.name);

/** States for a given country name (case-insensitive). Empty array if unknown. */
export function statesForCountry(country: string | null | undefined): string[] {
  if (!country) return [];
  const c = COUNTRIES_DATA.find((x) => x.name.toLowerCase() === country.trim().toLowerCase());
  return c ? Object.keys(c.states) : [];
}

/** Cities for a given country + state (case-insensitive). Empty array if unknown. */
export function citiesForState(country: string | null | undefined, state: string | null | undefined): string[] {
  if (!country || !state) return [];
  const c = COUNTRIES_DATA.find((x) => x.name.toLowerCase() === country.trim().toLowerCase());
  if (!c) return [];
  const key = Object.keys(c.states).find((s) => s.toLowerCase() === state.trim().toLowerCase());
  return key ? c.states[key] : [];
}

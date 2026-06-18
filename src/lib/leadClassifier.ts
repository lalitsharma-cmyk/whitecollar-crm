// ─────────────────────────────────────────────────────────────────────────────
// leadClassifier.ts — auto-classification for NEW incoming website-form leads.
// Owner-approved spec (2026-06-18, final).
//
// PRIORITY for market/team (owner rule 5):
//   1. SPECIFIC project (project DB decides the market) — HIGHEST
//   2. Event market   (expo / roadshow / investor event → geographic market word)
//   3. Blog topic     (geographic market word)
//   4. Source rules
//   5. Awaiting        (not 100% sure → never guess)
//
// HARD RULES:
//   • Route ONLY on: a specific PROJECT, or a geographic MARKET word
//     (Dubai/India/Gurgaon…). NEVER the client's city, location or phone.
//   • BARE BRAND names (Emaar, Sobha, DAMAC, Godrej, DLF…) → Awaiting,
//     routingReason "Ambiguous Brand". A SPECIFIC project routes:
//       – exact DB project            → its market (e.g. Sobha Central → Dubai)
//       – brand + project name where the brand is SINGLE-market in the DB
//                                      → that market (e.g. DAMAC Riverside → Dubai)
//       – brand + project name where the brand spans BOTH markets (e.g. Emaar)
//                                      → Awaiting (can't confirm — never guess)
//   • An event's LOCATION city (a Dubai expo held in Mumbai) is the event city,
//     NOT the market — stripped before market detection.
//
// PURE module (projects passed in). Writes NOTHING — caller maps onto NEW leads.
// ─────────────────────────────────────────────────────────────────────────────

export type Market = "Dubai" | "India";
export type Team = Market;
export type LeadType = "Event Lead" | "Property Lead";
export type ClassifyRule = "project" | "event" | "blog" | "source" | "awaiting";

export interface ClassifySignals {
  source?: string | null;
  sourceRaw?: string | null;
  sourceDetail?: string | null;
  project?: string | null;
  url?: string | null;
  message?: string | null;
  city?: string | null; // event-location fallback ONLY — never routes
}

export interface ProjectRef { name: string; city: string | null; country: string | null; } // "UAE" | "India"

export interface Classification {
  isBlog: boolean;
  source: string;
  leadType: LeadType | null;
  market: Market | null;
  team: Team | null;
  project: string | null;
  eventCity: string | null;
  status: "Fresh Lead";
  confidence: "high" | "low";
  rule: ClassifyRule;
  auditSource: string;
  reason: string;
}

const GEO_DUBAI = [
  "dubai", "uae", "u a e", "emirates", "abu dhabi", "sharjah", "ajman", "ras al khaimah",
  "dubai marina", "downtown dubai", "business bay", "palm jumeirah", "jumeirah", "jbr",
  "jvc", "jlt", "dubai creek", "dubai hills", "dubai south", "expo city", "meydan",
  "al barsha", "deira", "bur dubai",
];
const GEO_INDIA = [
  "india", "bharat", "gurgaon", "gurugram", "noida", "greater noida", "delhi", "new delhi",
  "ncr", "mumbai", "navi mumbai", "thane", "pune", "bengaluru", "bangalore", "hyderabad",
  "chennai", "kolkata", "goa", "sohna", "faridabad", "ghaziabad", "dwarka",
];
const GEO_SINGLE = new Set([...GEO_DUBAI, ...GEO_INDIA].filter((g) => !g.includes(" ")));
const FILLERS = new Set(["the", "by", "at", "of", "and", "de", "residences", "residence", "phase"]);

const countryToTeam = (c: string | null | undefined): Team | null =>
  c === "UAE" ? "Dubai" : c === "India" ? "India" : null;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (t: string, term: string) => new RegExp(`(^|[^a-z])${esc(term)}([^a-z]|$)`).test(t);

const EVENT_RE = /\b(property\s*expo|expo|investor\s*event|exhibition|property\s*show|road\s*show|roadshow|fair|exhibit)\b/i;

function detectBlog(s: ClassifySignals): boolean {
  return /blog/.test(`${s.source ?? ""} ${s.sourceRaw ?? ""} ${s.url ?? ""} ${s.sourceDetail ?? ""}`.toLowerCase());
}

function geoMatch(text: string): { team: Team | null; ambiguous: boolean; term: string | null } {
  const t = norm(text);
  const d = GEO_DUBAI.find((g) => wordHit(t, g));
  const i = GEO_INDIA.find((g) => wordHit(t, g));
  if (d && i) return { team: null, ambiguous: true, term: `${d}/${i}` };
  if (d) return { team: "Dubai", ambiguous: false, term: d };
  if (i) return { team: "India", ambiguous: false, term: i };
  return { team: null, ambiguous: false, term: null };
}

// Brand prefixes (1- or 2-token leading phrase shared by ≥2 projects). UNIFORM
// rule (owner): a bare brand NEVER routes — only a specific project (in the
// Project Master) does, regardless of whether the brand is single- or both-market.
function buildBrands(projects: ProjectRef[]): Set<string> {
  const count = new Map<string, number>();
  for (const p of projects) {
    const toks = norm(p.name).split(" ").filter((w) => w.length > 1);
    if (toks[0]) count.set(toks[0], (count.get(toks[0]) ?? 0) + 1);
    if (toks.length >= 2) { const k = `${toks[0]} ${toks[1]}`; count.set(k, (count.get(k) ?? 0) + 1); }
  }
  const brands = new Set<string>();
  for (const [k, n] of count) if (n >= 2) brands.add(k);
  return brands;
}

function brandLenOf(toks: string[], brands: Set<string>): number {
  return brands.has(toks.slice(0, 2).join(" ")) ? 2 : brands.has(toks[0]) ? 1 : 0;
}

/** Resolve market from a SPECIFIC project in the Project Master. UNIFORM for all
 *  developers: a bare brand (or brand + filler like "DLF The") never routes →
 *  Awaiting. Only a distinctive project match (brand + a real project word that
 *  exists in the master) routes, to that project's market. */
function projectMatch(text: string, projects: ProjectRef[], brands: Set<string>): {
  team: Team | null; ambiguous: boolean; bareBrand: boolean; project: string | null; via: string | null;
} {
  const t = ` ${norm(text)} `;
  let maxLen = 0;
  const hits: ProjectRef[] = [];
  let display: string | null = null;
  for (const p of projects) {
    const toks = norm(p.name).split(" ").filter((w) => w.length > 1);
    if (toks.length < 2) continue;
    const bl = brandLenOf(toks, brands);
    let matchedLen = 0;
    for (let len = toks.length; len >= 2; len--) {
      const phrase = toks.slice(0, len).join(" ");
      if (phrase.length >= 6 && t.includes(` ${phrase} `)) { matchedLen = len; break; }
    }
    if (matchedLen <= bl) continue;                                   // only the bare brand matched
    const beyond = toks.slice(bl, matchedLen);
    if (!beyond.some((w) => !FILLERS.has(w) && w.length >= 3)) continue; // brand + filler only
    if (matchedLen > maxLen) { maxLen = matchedLen; hits.length = 0; }
    if (matchedLen === maxLen) hits.push(p);
    if (matchedLen >= 3) display = p.name;
  }
  if (hits.length) {
    const markets = new Set(hits.map((p) => countryToTeam(p.country)).filter(Boolean));
    if (markets.size > 1) return { team: null, ambiguous: true, bareBrand: false, project: null, via: null };
    const team = [...markets][0] as Team;
    const project = hits.length === 1 ? hits[0].name : display;
    return { team, ambiguous: false, bareBrand: false, project, via: hits[0].name };
  }
  // No specific project. If a brand name is present anywhere → Ambiguous Brand.
  for (const brand of [...brands].sort((a, b) => b.length - a.length)) {
    if (t.includes(` ${brand} `)) return { team: null, ambiguous: false, bareBrand: true, project: null, via: brand };
  }
  return { team: null, ambiguous: false, bareBrand: false, project: null, via: null };
}

function eventCityAndStrip(text: string, fallbackCity?: string | null): { city: string | null; stripped: string } {
  const re = /\b(?:property\s*expo|expo|property\s*show|show|exhibition|roadshow|road\s*show|fair|exhibit|event)\b\s*(?:\bin\b|\bat\b)\s+([A-Za-z][A-Za-z]+(?:\s[A-Za-z]+)?)/i;
  const m = text.match(re);
  if (m) {
    const city = titleCase(m[1].trim());
    const stripped = text.replace(new RegExp(`\\b(?:in|at)\\s+${esc(m[1])}`, "i"), " ");
    return { city, stripped };
  }
  return { city: fallbackCity && /^[a-zA-Z ]{2,}$/.test(fallbackCity) ? titleCase(fallbackCity.trim()) : null, stripped: text };
}

export function classifyLead(signals: ClassifySignals, projects: ProjectRef[]): Classification {
  const routeText = [signals.message, signals.sourceDetail, signals.project, signals.url].filter(Boolean).join("  ");
  const eventText = [routeText, signals.sourceRaw].filter(Boolean).join("  ");
  const isBlog = detectBlog(signals);
  const isEvent = EVENT_RE.test(eventText);

  const ev = isEvent ? eventCityAndStrip(routeText, signals.city) : { city: null, stripped: routeText };
  const brands = buildBrands(projects);
  const pm = projectMatch(routeText, projects, brands);
  const geo = geoMatch(ev.stripped);

  let team: Team | null;
  let rule: ClassifyRule;
  if (pm.team) { team = pm.team; rule = "project"; }
  else if (geo.team) { team = geo.team; rule = isEvent ? "event" : isBlog ? "blog" : "source"; }
  else { team = null; rule = "awaiting"; }

  const market: Market | null = team;
  const leadType: LeadType | null = isEvent ? "Event Lead" : (team ? "Property Lead" : null);
  const eventCity = isEvent ? ev.city : null;
  const source = isBlog ? "Blog" : isEvent ? "Event" : (signals.sourceRaw?.trim() || "Website");
  const confidence: "high" | "low" = team ? "high" : "low";

  let auditSource: string;
  let reason: string;
  if (team) {
    auditSource =
      rule === "project" ? `project:${pm.via}`
      : rule === "event" ? `event:${geo.term}${eventCity ? `/${eventCity}` : ""}`
      : rule === "blog" ? `blog:${geo.term}`
      : `keyword:${geo.term}`;
    reason = `Auto-classified ${team} (${leadType}${eventCity ? `, event in ${eventCity}` : ""}) — ` +
      (rule === "project" ? `matched project "${pm.via}" → ${team} market`
        : rule === "event" ? `event market word "${geo.term}"`
        : rule === "blog" ? `blog topic market word "${geo.term}"`
        : `market word "${geo.term}"`);
  } else if (pm.bareBrand) {
    auditSource = "Ambiguous Brand";
    reason = `Awaiting — Ambiguous Brand "${pm.via}" with no specific project (never guess). Fresh Lead.`;
  } else if (pm.ambiguous) {
    auditSource = "Ambiguous Brand";
    reason = `Awaiting — "${pm.via}" project not in DB and brand spans both markets (never guess). Fresh Lead.`;
  } else if (geo.ambiguous) {
    auditSource = "Ambiguous";
    reason = `Awaiting — text names both markets (${geo.term}). Fresh Lead.`;
  } else {
    auditSource = "awaiting";
    reason = `Awaiting — no clear market signal (never guess). Fresh Lead.`;
  }

  return { isBlog, source, leadType, market, team, project: pm.project, eventCity, status: "Fresh Lead", confidence, rule, auditSource, reason };
}

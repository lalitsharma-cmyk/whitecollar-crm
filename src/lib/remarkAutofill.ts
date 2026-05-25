// Heuristic field extraction from free-text remarks.
//
// Lalit's MIS sheets stuffed a LOT of structured signal into the Remarks cell
// (budget mentions, project names, decision-maker hints, etc.). Once we import
// a sheet we want to PRE-FILL the structured columns wherever we can confidently
// pull a value out of the text — so the agent doesn't have to re-key.
//
// Conservative on purpose: this is regex + project-name match, NOT AI. False
// positives are worse than false negatives because they'd overwrite real data.
// We only return suggestions; the caller decides whether to apply them
// (a `force` flag controls whether to overwrite existing values).
//
// Used in two places:
//   1. CSV import (src/app/api/intake/csv/route.ts) — runs once per row after
//      `remarks` is set, autofills empty columns.
//   2. "🪄 Auto-fill from remarks" button on lead detail — admin/agent can
//      manually trigger after editing remarks.

import { Potential, FundReadiness, InvestTimeline, Profession } from "@prisma/client";

export interface Suggestions {
  budgetMin?: number;
  budgetMax?: number;
  budgetCurrency?: "AED" | "INR";
  configuration?: string;
  city?: string;
  potential?: Potential;
  fundReadiness?: FundReadiness;
  whenCanInvest?: InvestTimeline;
  profession?: Profession;
  company?: string;
  sourceDetail?: string;  // project name they're interested in
  forwardedTeam?: "Dubai" | "India";
}

/** Parse a single budget mention. "3-4 crores" → {min, max}. "2.5M AED" → just min. */
function parseBudget(text: string): { min?: number; max?: number; currency?: "AED" | "INR" } | null {
  const lower = text.toLowerCase();
  // Range: "3-4 cr", "3 to 4 crores", "2.5-3 million"
  const rangeMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(cr|crore|crores|m|million|mn|lakh|lakhs|l|k)\b/);
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    const unit = rangeMatch[3];
    const mult = unitMultiplier(unit);
    return { min: a * mult, max: b * mult, currency: guessCurrency(lower, unit) };
  }
  // Single: "budget of 5cr", "AED 2.5M", "around 30 lakh"
  const singleMatch = lower.match(/(\d+(?:\.\d+)?)\s*(cr|crore|crores|m|million|mn|lakh|lakhs|l|k)\b/);
  if (singleMatch) {
    const v = parseFloat(singleMatch[1]);
    const unit = singleMatch[2];
    const mult = unitMultiplier(unit);
    return { min: v * mult, currency: guessCurrency(lower, unit) };
  }
  return null;
}

function unitMultiplier(unit: string): number {
  const u = unit.toLowerCase();
  if (u === "cr" || u === "crore" || u === "crores") return 10_000_000;        // 1 Cr = 10M INR
  if (u === "m" || u === "million" || u === "mn") return 1_000_000;
  if (u === "lakh" || u === "lakhs" || u === "l") return 100_000;
  if (u === "k") return 1_000;
  return 1;
}

function guessCurrency(lower: string, unit: string): "AED" | "INR" | undefined {
  if (/aed|dirham|د\.إ/.test(lower)) return "AED";
  if (/inr|rs\.?|rupee|₹|crore|lakh/i.test(lower) || /cr|crore|lakh/i.test(unit)) return "INR";
  if (/million|usd|\$/.test(lower)) return undefined; // ambiguous
  return undefined;
}

/** Match BHK / Villa / Penthouse style configuration. */
function parseConfiguration(text: string): string | undefined {
  const lower = text.toLowerCase();
  const bhk = lower.match(/(\d)\s*-?\s*bhk/i);
  if (bhk) return `${bhk[1]}BHK`;
  const br = lower.match(/(\d)\s*-?\s*(?:br|bedroom|bed)\b/i);
  if (br) return `${br[1]}BR`;
  if (/villa\b/i.test(text)) return "Villa";
  if (/penthouse|ph\b/i.test(text)) return "Penthouse";
  if (/studio\b/i.test(text)) return "Studio";
  if (/plot\b/i.test(text)) return "Plot";
  return undefined;
}

/** Detect "NRI" / "Investor" / "End-user" categorisation hints — returns Potential. */
function parsePotential(text: string): Potential | undefined {
  const lower = text.toLowerCase();
  if (/(?:hot|highly interested|very interested|ready to (?:book|buy|close)|signed)/i.test(text)) return Potential.HIGH;
  if (/(?:not interested|drop my query|cancel|wrong number|nai|do not call)/i.test(text)) return Potential.LOW;
  if (/(?:interested|warm|positive|will visit|considering|looking)/i.test(text)) return Potential.MEDIUM;
  if (/(?:cold|just browsing|window shopping|no response|switched off)/i.test(lower)) return Potential.LOW;
  return undefined;
}

function parseFund(text: string): FundReadiness | undefined {
  if (/cash\s*ready|paying cash|all cash/i.test(text)) return FundReadiness.CASH_READY;
  if (/bank\s*(?:approved|pre.?approved)|mortgage approved|loan approved/i.test(text)) return FundReadiness.BANK_APPROVED;
  if (/needs?\s*(?:loan|financing|mortgage)|loan required|financing needed/i.test(text)) return FundReadiness.FINANCING_NEEDED;
  return undefined;
}

function parseTimeline(text: string): InvestTimeline | undefined {
  if (/this\s*week|immediate|asap|right now|today/i.test(text)) return InvestTimeline.IMMEDIATE;
  if (/within\s*30\s*days?|next\s*month|by month.?end/i.test(text)) return InvestTimeline.THIRTY_DAYS;
  if (/in\s*\d?\s*-?3\s*months?|quarter/i.test(text)) return InvestTimeline.THREE_MONTHS;
  if (/(?:in|after)\s*6\s*months?|next year|year.?end|long.?term/i.test(text)) return InvestTimeline.SIX_PLUS_MONTHS;
  if (/(?:browsing|exploring|just looking|window shopping|not decided)/i.test(text)) return InvestTimeline.WINDOW_SHOPPING;
  return undefined;
}

function parseProfession(text: string): Profession | undefined {
  if (/business\s*(?:owner|man)|owns? (?:a )?business|entrepreneur|founder|ceo|director|cofounder/i.test(text)) return Profession.BUSINESS_OWNER;
  if (/self.?employed|freelance|consultant|own practice/i.test(text)) return Profession.SELF_EMPLOYED;
  if (/govt\s*service|govt\.?\s*job|government job|govt employee|psu|navy|army/i.test(text)) return Profession.JOB;
  if (/works? (?:at|for|in)|employed at|senior (?:engineer|manager|director|vp)|software (?:engineer|developer)|job in/i.test(text)) return Profession.JOB;
  if (/investor|invests in|portfolio investor/i.test(text)) return Profession.INVESTOR;
  if (/retired/i.test(text)) return Profession.RETIRED;
  return undefined;
}

/** First India city / Dubai-area mention → city. */
function parseCity(text: string): string | undefined {
  // Common India + Dubai property cities
  const cities = [
    "Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Ajman",
    "Mumbai", "Delhi", "Gurgaon", "Gurugram", "Noida", "Bangalore", "Bengaluru",
    "Chennai", "Pune", "Hyderabad", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow",
    "Chandigarh", "Ludhiana", "Amritsar", "Goa", "Surat", "Indore",
  ];
  for (const c of cities) {
    const re = new RegExp(`\\b${c}\\b`, "i");
    if (re.test(text)) return c;
  }
  return undefined;
}

/** "Dubai" / "India" team hint from text */
function parseTeam(text: string, extractedCity?: string): "Dubai" | "India" | undefined {
  const isUae = ["Dubai", "Abu Dhabi", "Sharjah", "Ras Al Khaimah", "Ajman"].some((c) => c === extractedCity);
  if (isUae) return "Dubai";
  if (extractedCity) return "India";
  if (/dubai|uae|emirates|aed/i.test(text)) return "Dubai";
  if (/india|inr|crore|lakh|delhi|mumbai|bangalore/i.test(text)) return "India";
  return undefined;
}

/** Match the first known project name in the remarks. */
function parseProject(text: string, knownProjects: string[]): string | undefined {
  for (const p of knownProjects) {
    if (!p || p.length < 3) continue;
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) return p;
  }
  return undefined;
}

/** Company name — best-effort regex looking for "works at X" / "from Y". */
function parseCompany(text: string): string | undefined {
  // "Senior Director at consulting firm" / "works at Emirates NBD"
  const m = text.match(/(?:works\s+at|employed\s+at|director\s+at|manager\s+at|senior\s+\w+\s+at)\s+([A-Z][A-Za-z0-9 &.-]{2,40}?)(?:\.|,|;|\n|$)/);
  if (m && m[1]) return m[1].trim();
  return undefined;
}

/**
 * Run all extractors against `remarks` and return a Suggestions object containing
 * only the keys we're confident about.
 */
export function extractFromRemarks(remarks: string, knownProjects: string[] = []): Suggestions {
  if (!remarks || typeof remarks !== "string" || remarks.length < 5) return {};
  const out: Suggestions = {};

  const budget = parseBudget(remarks);
  if (budget?.min) out.budgetMin = budget.min;
  if (budget?.max) out.budgetMax = budget.max;
  if (budget?.currency) out.budgetCurrency = budget.currency;

  const cfg = parseConfiguration(remarks);
  if (cfg) out.configuration = cfg;

  const city = parseCity(remarks);
  if (city) out.city = city;

  const team = parseTeam(remarks, city);
  if (team) out.forwardedTeam = team;

  const pot = parsePotential(remarks);
  if (pot) out.potential = pot;

  const fund = parseFund(remarks);
  if (fund) out.fundReadiness = fund;

  const when = parseTimeline(remarks);
  if (when) out.whenCanInvest = when;

  const prof = parseProfession(remarks);
  if (prof) out.profession = prof;

  const project = parseProject(remarks, knownProjects);
  if (project) out.sourceDetail = project;

  const company = parseCompany(remarks);
  if (company) out.company = company;

  return out;
}

/**
 * Apply suggestions on top of an existing Lead, returning ONLY the fields we
 * should write to the database. If `force` is false (default), we never
 * overwrite a field the lead already has — autofill is additive.
 */
export function mergeSuggestions(
  existing: Partial<Suggestions>,
  suggestions: Suggestions,
  force = false,
): Suggestions {
  const out: Suggestions = {};
  for (const k of Object.keys(suggestions) as (keyof Suggestions)[]) {
    const newVal = suggestions[k];
    const oldVal = existing[k];
    if (newVal == null) continue;
    if (force || oldVal == null || oldVal === "") {
      // @ts-expect-error narrow union
      out[k] = newVal;
    }
  }
  return out;
}

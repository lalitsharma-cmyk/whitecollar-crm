// ────────────────────────────────────────────────────────────────────────────
// Customer layer — DUPLICATE DETECTION engine (Step 1 foundation).
//
// SCOPE (owner, non-negotiable): this engine DETECTS, SCORES, and RECOMMENDS
// only. It NEVER auto-merges, links, deletes, or reassigns anything. It is a
// pure function over (lead, candidatePool) → scored matches. The human (admin)
// always makes the merge/link decision through the audited link service.
//
// PURE: no DB, no "server-only", no Date.now(). The server fetches the candidate
// pool (already role-scoped + deletedAt:null) and passes it in. That keeps this
// unit-testable with fixed inputs and importable into the read-only regression
// harness.
//
// Matching mirrors the rest of the CRM for consistency:
//   • phone canonical  = last-10 digits (lib/dedup, customerHistory convention)
//   • name similarity  = Levenshtein(normName) ≤ 3 (lib/intelligenceCheck)
//   • email            = case-insensitive exact
//
// Confidence tiers (owner spec):
//   Very High — same mobile OR same email OR (email + similar name)
//   High      — (similar name + same email, different phone) OR (same phone, different name)
//   Medium    — name only / similar name + same company
// Deleted (deletedAt) candidates are excluded by the caller AND defensively here.
// ────────────────────────────────────────────────────────────────────────────

import { computeCustomerConfidence } from "./compute";
import type { CustomerEnquiryInput } from "./types";

export type ConfidenceTier = "Very High" | "High" | "Medium" | "None";

/** A candidate lead to test against — same minimal shape, plus a deleted flag. */
export interface DetectCandidate extends CustomerEnquiryInput {
  /** When true (soft-deleted / recycle-bin) the candidate is skipped entirely. */
  deleted?: boolean;
}

/** One scored match against a candidate. */
export interface DetectMatch {
  matchedLeadId: string;
  /** 0–100 live confidence score (computeCustomerConfidence). */
  score: number;
  /** The qualitative tier driving the merge recommendation. */
  tier: ConfidenceTier;
  /** Human-readable evidence, e.g. ["Same email", "Similar name"]. */
  reasons: string[];
  /** The raw boolean factors that produced the score (audit/snapshot source). */
  factors: {
    sameMobile: boolean;
    sameEmail: boolean;
    similarName: boolean;
    sameCompany: boolean;
    sameAlternateNumber: boolean;
  };
}

// ── normalisation (mirrors lib/intelligenceCheck + lib/dedup) ─────────────────

/** Canonical last-10-digit phone key. Empty string when too short to compare. */
function last10(s: string | null | undefined): string {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
}

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normEmail(e: string | null | undefined): string {
  return (e ?? "").toLowerCase().trim();
}

function normCompany(c: string | null | undefined): string {
  return (c ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Inline Levenshtein (mirrors lib/intelligenceCheck — names are short). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** True when two names are the SAME or a trivial variant (≤3 edits), per CRM convention. */
export function namesSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Guard: very different lengths can't be ≤3 edits — skip the DP.
  if (Math.abs(x.length - y.length) > 3) return false;
  return levenshtein(x, y) <= 3;
}

/**
 * Compare the {phone, altPhone} of lead vs candidate on the last-10 key.
 *   sameMobile    = primary↔primary match (the strongest phone signal).
 *   sameAlternate = any OTHER last-10 overlap across the four slots
 *                   (alt↔alt, primary↔alt, alt↔primary) when not primary↔primary.
 */
function phoneOverlap(
  lead: CustomerEnquiryInput,
  cand: DetectCandidate,
): { sameMobile: boolean; sameAlternate: boolean } {
  const lPrimary = last10(lead.phone);
  const cPrimary = last10(cand.phone);
  const sameMobile = !!lPrimary && lPrimary === cPrimary;

  // Any shared last-10 across all four slots.
  const lKeys = [lPrimary, last10(lead.altPhone)].filter(Boolean);
  const cKeys = [cPrimary, last10(cand.altPhone)].filter(Boolean);
  const anyOverlap = lKeys.some((k) => cKeys.includes(k));

  // sameAlternate = an overlap exists that is NOT the primary↔primary one.
  return { sameMobile, sameAlternate: anyOverlap && !sameMobile };
}

function emailsEqual(lead: CustomerEnquiryInput, cand: DetectCandidate): boolean {
  const l = [normEmail(lead.email), normEmail(lead.altEmail)].filter(Boolean);
  const c = [normEmail(cand.email), normEmail(cand.altEmail)].filter(Boolean);
  return l.some((e) => c.includes(e));
}

/** Derive the qualitative tier from the boolean factors (owner spec). */
export function tierForFactors(f: DetectMatch["factors"]): ConfidenceTier {
  // Very High — same mobile, OR same email (email+name is a superset of same-email).
  if (f.sameMobile || f.sameEmail) return "Very High";
  // High — a non-primary phone overlap (alternate number shared). Covers
  //   "same phone, different name" and "similar name + alternate number".
  if (f.sameAlternateNumber) return "High";
  // Medium — name-only, or similar name + same company.
  if (f.similarName) return "Medium";
  return "None";
}

/**
 * Score ONE lead against ONE candidate. Returns null when there is no meaningful
 * signal at all (tier "None" with score 0) so the caller can drop non-matches.
 */
export function scoreCandidate(
  lead: CustomerEnquiryInput,
  cand: DetectCandidate,
): DetectMatch | null {
  if (cand.deleted) return null;          // recycle-bin never participates
  if (cand.id === lead.id) return null;   // never match a lead to itself

  const { sameMobile, sameAlternate } = phoneOverlap(lead, cand);
  const sameEmail = emailsEqual(lead, cand);
  const similarName = namesSimilar(lead.name, cand.name);
  const sameCompany =
    !!normCompany(lead.company) && normCompany(lead.company) === normCompany(cand.company);

  const factors = {
    sameMobile,
    sameEmail,
    similarName,
    sameCompany,
    sameAlternateNumber: sameAlternate,
  };

  // No signal at all → not a candidate.
  if (!sameMobile && !sameEmail && !similarName && !sameCompany && !sameAlternate) {
    return null;
  }

  // A bare company-only match (no name/phone/email overlap) is too weak to surface.
  if (sameCompany && !sameMobile && !sameEmail && !similarName && !sameAlternate) {
    return null;
  }

  const { score, reasons } = computeCustomerConfidence(factors);
  const tier = tierForFactors(factors);
  if (tier === "None") return null;

  return { matchedLeadId: cand.id, score, tier, reasons, factors };
}

/**
 * Detect duplicate/sibling candidates for `lead` within `candidatePool`.
 * Returns scored matches sorted strongest-first (score desc, then tier rank).
 * DETECT/SCORE/RECOMMEND ONLY — performs no writes and makes no link decision.
 */
export function detectCandidates(
  lead: CustomerEnquiryInput,
  candidatePool: DetectCandidate[],
): DetectMatch[] {
  const tierRank: Record<ConfidenceTier, number> = { "Very High": 0, High: 1, Medium: 2, None: 3 };
  const out: DetectMatch[] = [];
  for (const cand of candidatePool) {
    const m = scoreCandidate(lead, cand);
    if (m) out.push(m);
  }
  out.sort((a, b) => (b.score - a.score) || (tierRank[a.tier] - tierRank[b.tier]));
  return out;
}

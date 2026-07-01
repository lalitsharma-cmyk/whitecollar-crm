// ────────────────────────────────────────────────────────────────────────────
// Customer layer — PURE search ranking (Rule 5). Split out from search.ts so it
// carries NO "server-only" and can be unit-tested + imported into the read-only
// regression harness. search.ts re-exports these.
//
// LOCKED 6-step ranking order (owner-confirmed):
//   1. confidence score (match strength)            desc
//   2. verified mobile match (exact normalized)     verified-first
//   3. verified email match  (exact normalized)     verified-first
//   4. recent activity                              desc (nulls last)
//   5. number of enquiries                          desc
//   6. active-customers-first (Active>Converted>Closed)
//
// "Verified" means EXACT normalized phone/email equality — NOT fuzzy. The intent
// (owner): a verified-mobile match must OUTRANK a similar-name match. Because a
// verified mobile/email hit also drives confidence to 100 in search.ts, steps
// 2–3 are the decisive tie-break BETWEEN two equally-confident hits (e.g. two
// rows that both matched at 100, one by verified mobile and one by verified
// email) — and they guarantee a verified contact match sorts above a fuzzy
// name-only hit even in the (clamped-confidence) edge cases.
// ────────────────────────────────────────────────────────────────────────────

import type { CustomerStatus } from "./types";

/** One ranked search hit at the customer layer. */
export interface CustomerSearchRow {
  customerId: string;
  displayName: string;
  status: CustomerStatus;
  ownerOfRecord: string;
  enquiryCount: number;
  lastActivityAt: Date | null;
  /** Match confidence/strength for THIS query (0–100). Higher = better match. */
  confidence: number;
  /** EXACT normalized last-10 phone match against the query (verified, not fuzzy). */
  verifiedMobile: boolean;
  /** EXACT normalized email match against the query (verified, not fuzzy). */
  verifiedEmail: boolean;
  phones: string[];
  emails: string[];
}

// Status rank for "active-first" tie-break (lower = higher priority).
const STATUS_RANK: Record<CustomerStatus, number> = { Active: 0, Converted: 1, Closed: 2 };

// A verified flag is "better" when true → it should sort first. Map true→0, false→1.
const verifiedRank = (v: boolean): number => (v ? 0 : 1);

/**
 * PURE ranking comparator — the LOCKED 6-step order (Rule 5):
 *   1. confidence desc
 *   2. verified mobile match first
 *   3. verified email match first
 *   4. most recent activity desc (nulls last)
 *   5. enquiry count desc
 *   6. active-first
 * Returns <0 when `a` should sort before `b`.
 */
export function rankCustomerSearch(a: CustomerSearchRow, b: CustomerSearchRow): number {
  // 1. confidence desc
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  // 2. verified mobile match first (verified beats non-verified / similar-name)
  if (a.verifiedMobile !== b.verifiedMobile) return verifiedRank(a.verifiedMobile) - verifiedRank(b.verifiedMobile);
  // 3. verified email match first
  if (a.verifiedEmail !== b.verifiedEmail) return verifiedRank(a.verifiedEmail) - verifiedRank(b.verifiedEmail);
  // 4. most recent activity desc (nulls last)
  const at = a.lastActivityAt?.getTime() ?? -Infinity;
  const bt = b.lastActivityAt?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  // 5. enquiry count desc
  if (a.enquiryCount !== b.enquiryCount) return b.enquiryCount - a.enquiryCount;
  // 6. active-first
  return STATUS_RANK[a.status] - STATUS_RANK[b.status];
}

/** Sort a set of customer search rows by the Rule-5 ranking (returns a new array). */
export function rankCustomerSearchRows(rows: CustomerSearchRow[]): CustomerSearchRow[] {
  return [...rows].sort(rankCustomerSearch);
}

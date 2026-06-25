// ────────────────────────────────────────────────────────────────────────────
// Customer layer — PURE search ranking (Rule 5). Split out from search.ts so it
// carries NO "server-only" and can be unit-tested + imported into the read-only
// regression harness. search.ts re-exports these.
//
// Ranking order (Rule 5): confidence → recent activity → enquiry count →
// active-first.
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
  phones: string[];
  emails: string[];
}

// Status rank for "active-first" tie-break (lower = higher priority).
const STATUS_RANK: Record<CustomerStatus, number> = { Active: 0, Converted: 1, Closed: 2 };

/**
 * PURE ranking comparator (Rule 5): confidence → recent activity → enquiry count
 * → active-first. Returns <0 when `a` should sort before `b`.
 */
export function rankCustomerSearch(a: CustomerSearchRow, b: CustomerSearchRow): number {
  // 1. confidence desc
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  // 2. most recent activity desc (nulls last)
  const at = a.lastActivityAt?.getTime() ?? -Infinity;
  const bt = b.lastActivityAt?.getTime() ?? -Infinity;
  if (at !== bt) return bt - at;
  // 3. enquiry count desc
  if (a.enquiryCount !== b.enquiryCount) return b.enquiryCount - a.enquiryCount;
  // 4. active-first
  return STATUS_RANK[a.status] - STATUS_RANK[b.status];
}

/** Sort a set of customer search rows by the Rule-5 ranking (returns a new array). */
export function rankCustomerSearchRows(rows: CustomerSearchRow[]): CustomerSearchRow[] {
  return [...rows].sort(rankCustomerSearch);
}

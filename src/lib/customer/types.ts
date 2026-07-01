// ────────────────────────────────────────────────────────────────────────────
// Customer layer — shared pure types (Step 1 foundation).
//
// These describe the MINIMAL shape the computed layer + detection engine need.
// They are deliberately plain (no Prisma types) so the pure functions stay
// unit-testable with fixed inputs and importable into the read-only regression
// harness (no "server-only"). The server maps Prisma rows → these shapes.
// ────────────────────────────────────────────────────────────────────────────

/** The computed customer status — never stored, always derived from enquiries. */
export type CustomerStatus = "Active" | "Converted" | "Closed";

/** Sentinel returned by computeCustomerOwner when enquiries span >1 owner and no
 *  admin canonical owner is set. The caller renders this as "Multiple Owners". */
export const MULTIPLE_OWNERS = "MULTIPLE" as const;

/**
 * One enquiry (= one Lead) as the computed layer sees it. Only the fields the
 * pure functions read are required; everything else on the Lead is irrelevant
 * to status/owner/confidence/summary computation.
 */
export interface CustomerEnquiryInput {
  id: string;
  /** The lead's CURRENT MIS status (currentStatus). null/"" = fresh/unworked. */
  currentStatus: string | null;
  /** Owner (ownerId) of this enquiry — may be null (unassigned). */
  ownerId: string | null;
  // Contact + grouping signals — used by the summary rollup (all optional).
  name?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  altEmail?: string | null;
  company?: string | null;
  /** Property enquired (canonical sourceDetail). */
  sourceDetail?: string | null;
  /** Verbatim source label (sourceRaw) — the source-of-truth source string. */
  sourceRaw?: string | null;
  createdAt?: Date | null;
}

/** Factors fed to computeCustomerConfidence — each true factor adds a reason. */
export interface ConfidenceFactors {
  sameMobile?: boolean;
  sameEmail?: boolean;
  similarName?: boolean;
  sameCompany?: boolean;
  sameAlternateNumber?: boolean;
}

/** Result of computeCustomerConfidence — a live score + human-readable reasons. */
export interface ConfidenceResult {
  score: number;
  reasons: string[];
}

/** Union rollup across a customer's enquiries (additive — never overwrites). */
export interface CustomerSummary {
  phones: string[];
  emails: string[];
  projects: string[];
  sources: string[];
  owners: string[];
  enquiryCount: number;
  firstEnquiryAt: Date | null;
  lastEnquiryAt: Date | null;
}

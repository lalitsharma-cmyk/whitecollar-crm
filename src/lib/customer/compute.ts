// ────────────────────────────────────────────────────────────────────────────
// Customer layer — COMPUTED helpers (Step 1 foundation).
//
// Guiding principle (owner): "Everything that can be computed should be
// computed; everything that must be stored should be immutable."
//
// These are PURE functions. Given the same enquiries they return the same
// result — NO Date.now(), NO DB, NO I/O. They are the single source of truth for
// a customer's CURRENT status / owner-of-record / confidence / contact rollup,
// none of which is ever stored (so a new enquiry can never make a stored value
// go stale). The server calls these live every render.
//
// Status precedence is driven by the EXISTING canonical lead-status classifier
// (leadCategory in lead-statuses.ts), so the Customer layer agrees 1:1 with how
// every other surface buckets a lead. WORKABLE→Active, CLOSED→Converted,
// LOST→Closed.
// ────────────────────────────────────────────────────────────────────────────

import { leadCategory } from "@/lib/lead-statuses";
import {
  type CustomerStatus,
  type CustomerEnquiryInput,
  type ConfidenceFactors,
  type ConfidenceResult,
  type CustomerSummary,
  MULTIPLE_OWNERS,
} from "./types";

/**
 * Compute a customer's live status from its enquiries.
 *
 * Owner-confirmed precedence (first match wins):
 *   1. ANY enquiry is workable / non-terminal  → "Active"
 *   2. else ANY enquiry is a closed/converted deal (CLOSED outcome) → "Converted"
 *   3. else (all enquiries are rejected/lost — terminal LOST) → "Closed"
 *
 * Mapped through leadCategory (the canonical 3-bucket classifier):
 *   WORKABLE (incl. null / fresh / unknown) → Active
 *   CLOSED   (booked / sold / leased / bought-elsewhere — the deal is DONE) → Converted
 *   LOST     (rejected / dead-end) → Closed
 *
 * Empty input (a customer with no enquiries) → "Closed" (nothing active or
 * converted to show); callers normally never hit this since a customer must
 * have ≥1 linked enquiry to exist meaningfully.
 */
export function computeCustomerStatus(enquiries: CustomerEnquiryInput[]): CustomerStatus {
  if (enquiries.length === 0) return "Closed";
  let anyConverted = false;
  for (const e of enquiries) {
    const cat = leadCategory(e.currentStatus);
    if (cat === "WORKABLE") return "Active"; // precedence 1 — short-circuit
    if (cat === "CLOSED") anyConverted = true;
  }
  // No workable enquiry. If any was a closed/converted deal → Converted, else
  // every enquiry is LOST → Closed.
  return anyConverted ? "Converted" : "Closed";
}

/**
 * Compute the owner-of-record.
 *   - If an admin set canonicalOwnerId → that wins, ALWAYS (the one human override).
 *   - else if every enquiry shares ONE distinct owner → that single owner.
 *   - else (enquiries span multiple owners, or none has an owner) → "MULTIPLE".
 *
 * This NEVER auto-derives a change from a new enquiry: a freshly-linked enquiry
 * with a different owner just flips the computed value to "MULTIPLE"; it never
 * silently reassigns the customer to the new owner. To pin an owner, an admin
 * sets canonicalOwnerId explicitly.
 */
export function computeCustomerOwner(
  enquiries: CustomerEnquiryInput[],
  canonicalOwnerId: string | null | undefined,
): string {
  if (canonicalOwnerId) return canonicalOwnerId;
  const owners = new Set<string>();
  for (const e of enquiries) {
    if (e.ownerId) owners.add(e.ownerId);
  }
  if (owners.size === 1) return [...owners][0];
  return MULTIPLE_OWNERS;
}

/**
 * Compute a LIVE confidence score + the human-readable reasons behind it.
 * Never stored — recomputed on demand (e.g. for a merge suggestion). Each true
 * factor contributes a weight and a reason string. The weights mirror the
 * detection engine's tiering: a shared mobile or email is the strongest signal.
 *
 * Score is clamped 0–100. Reasons are returned in a stable, weight-desc order so
 * the UI lists the strongest evidence first.
 */
export function computeCustomerConfidence(factors: ConfidenceFactors): ConfidenceResult {
  // (weight, reason) per factor — order here defines the reason display order.
  const table: Array<{ on: boolean | undefined; weight: number; reason: string }> = [
    { on: factors.sameMobile,          weight: 60, reason: "Same mobile" },
    { on: factors.sameEmail,           weight: 55, reason: "Same email" },
    { on: factors.sameAlternateNumber, weight: 35, reason: "Same alternate number" },
    { on: factors.sameCompany,         weight: 20, reason: "Same company" },
    { on: factors.similarName,         weight: 25, reason: "Similar name" },
  ];
  let score = 0;
  const reasons: string[] = [];
  for (const f of table) {
    if (f.on) {
      score += f.weight;
      reasons.push(f.reason);
    }
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

// ── summary helpers (pure) ───────────────────────────────────────────────────

/** Distinct, order-preserving, trimmed, non-empty values (case-insensitive de-dupe). */
function uniqStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Compute the union rollup across a customer's enquiries — ADDITIVE: it unions
 * every phone, email, project, source and owner seen across the linked
 * enquiries, plus the enquiry count and first/last enquiry dates. It NEVER
 * overwrites a "primary" — every value any enquiry carried is preserved.
 */
export function computeCustomerSummary(enquiries: CustomerEnquiryInput[]): CustomerSummary {
  const phones = uniqStrings(enquiries.flatMap((e) => [e.phone, e.altPhone]));
  const emails = uniqStrings(enquiries.flatMap((e) => [e.email, e.altEmail]));
  const projects = uniqStrings(enquiries.map((e) => e.sourceDetail));
  const sources = uniqStrings(enquiries.map((e) => e.sourceRaw));
  const owners = uniqStrings(enquiries.map((e) => e.ownerId));

  let firstEnquiryAt: Date | null = null;
  let lastEnquiryAt: Date | null = null;
  for (const e of enquiries) {
    const d = e.createdAt ?? null;
    if (!d) continue;
    if (firstEnquiryAt === null || d < firstEnquiryAt) firstEnquiryAt = d;
    if (lastEnquiryAt === null || d > lastEnquiryAt) lastEnquiryAt = d;
  }

  return {
    phones,
    emails,
    projects,
    sources,
    owners,
    enquiryCount: enquiries.length,
    firstEnquiryAt,
    lastEnquiryAt,
  };
}

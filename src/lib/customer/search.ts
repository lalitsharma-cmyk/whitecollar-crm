// ────────────────────────────────────────────────────────────────────────────
// Customer layer — SEARCH resolution + ranking (Step 1 foundation, Rule 5).
//
// Customer-LAYER-FIRST: a search for a person resolves to CUSTOMERS first (the
// canonical human), each carrying its computed status/owner/summary, and only
// falls through to raw standalone enquiries that aren't yet grouped. Results are
// ranked (Rule 5):
//   1. confidence (match strength) desc
//   2. most recent activity desc
//   3. enquiry count desc
//   4. active-first (Active > Converted > Closed)
//
// The DB query itself is role-scoped (leadScopeWhere) so an agent/manager only
// ever resolves customers whose enquiries they may see. The RANKING comparator
// is a PURE function (rankCustomerSearch) so it is unit-testable and importable
// into the regression harness; the server builds CustomerSearchRow[] then sorts
// with it.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere, type ScopedUser } from "@/lib/leadScope";
import { computeCustomerStatus, computeCustomerOwner, computeCustomerSummary } from "./compute";
import type { CustomerEnquiryInput } from "./types";
// Pure ranking lives in searchRank.ts (no "server-only") so it is unit-testable
// + importable into the regression harness. Re-export for existing callers.
import { rankCustomerSearchRows, type CustomerSearchRow } from "./searchRank";

export { rankCustomerSearch, rankCustomerSearchRows, type CustomerSearchRow } from "./searchRank";

// ── server resolution ─────────────────────────────────────────────────────────

const last10 = (s: string) => s.replace(/\D/g, "").slice(-10);

/**
 * Resolve a free-text query (name / phone / email fragment) to ranked customers
 * the caller is allowed to see. Customer-layer-first: only customers that have
 * at least one linked enquiry matching the query (within the caller's scope) are
 * returned, each with its LIVE computed status/owner/summary. Standalone
 * (un-grouped) enquiries are intentionally NOT promoted to customers here — that
 * is the link service's job; this resolves the canonical layer.
 *
 * `confidence` here reflects match quality: an exact phone/email hit ranks above
 * a partial name hit. (Detection-engine scoring is for merge suggestions; this
 * is search relevance.)
 */
export async function resolveCustomers(
  me: ScopedUser,
  query: string,
  limit = 20,
): Promise<CustomerSearchRow[]> {
  const q = query.trim();
  if (!q) return [];

  const scope = await leadScopeWhere(me); // role-scoped + deletedAt:null
  const digits = q.replace(/\D/g, "");
  const isPhoneish = digits.length >= 4;

  const orMatch: Prisma.LeadWhereInput[] = [
    { name: { contains: q, mode: "insensitive" } },
    { email: { contains: q, mode: "insensitive" } },
    { altEmail: { contains: q, mode: "insensitive" } },
  ];
  if (isPhoneish) {
    orMatch.push(
      { phone: { contains: digits } },
      { altPhone: { contains: digits } },
    );
  }

  // Find the DISTINCT customers whose (scoped) enquiries match the query.
  const matchingEnquiries = await prisma.lead.findMany({
    where: { AND: [scope, { customerId: { not: null } }, { OR: orMatch }] },
    select: { customerId: true },
    take: 500,
  });
  const customerIds = [...new Set(matchingEnquiries.map((l) => l.customerId).filter((x): x is string => !!x))];
  if (customerIds.length === 0) return [];

  // Load those customers + ALL their (scoped) enquiries to compute live fields.
  const customers = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: {
      id: true, displayName: true, canonicalOwnerId: true,
      enquiries: {
        where: scope,
        select: {
          id: true, currentStatus: true, ownerId: true, name: true,
          phone: true, altPhone: true, email: true, altEmail: true,
          company: true, sourceDetail: true, sourceRaw: true,
          createdAt: true, lastTouchedAt: true,
        },
      },
    },
  });

  const rows: CustomerSearchRow[] = customers.map((c) => {
    const enquiries: CustomerEnquiryInput[] = c.enquiries.map((e) => ({
      id: e.id, currentStatus: e.currentStatus, ownerId: e.ownerId, name: e.name,
      phone: e.phone, altPhone: e.altPhone, email: e.email, altEmail: e.altEmail,
      company: e.company, sourceDetail: e.sourceDetail, sourceRaw: e.sourceRaw,
      createdAt: e.createdAt,
    }));
    const summary = computeCustomerSummary(enquiries);
    const lastActivityAt = c.enquiries.reduce<Date | null>((acc, e) => {
      const t = e.lastTouchedAt ?? e.createdAt ?? null;
      if (!t) return acc;
      return acc === null || t > acc ? t : acc;
    }, null);

    // Search confidence: exact phone/email match → 100; exact (whole) name → 90;
    // otherwise a partial/contains hit → 60.
    let confidence = 60;
    const ql = q.toLowerCase();
    if (isPhoneish && summary.phones.some((p) => last10(p) === last10(q))) confidence = 100;
    else if (summary.emails.some((e) => e.toLowerCase() === ql)) confidence = 100;
    else if (c.displayName.toLowerCase() === ql) confidence = 90;

    return {
      customerId: c.id,
      displayName: c.displayName,
      status: computeCustomerStatus(enquiries),
      ownerOfRecord: computeCustomerOwner(enquiries, c.canonicalOwnerId),
      enquiryCount: summary.enquiryCount,
      lastActivityAt,
      confidence,
      phones: summary.phones,
      emails: summary.emails,
    };
  });

  return rankCustomerSearchRows(rows).slice(0, limit);
}

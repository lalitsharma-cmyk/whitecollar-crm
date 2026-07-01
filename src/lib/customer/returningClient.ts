// ────────────────────────────────────────────────────────────────────────────
// Customer layer — RETURNING-CLIENT view for the LEAD DETAIL (WS-J J4, READ-ONLY).
//
// Resolves "is the lead I'm viewing a returning client, and what is the merged
// picture?" for the lead-detail "Returning Client" card. Two paths:
//
//   1. LINKED — lead.customerId is set (the confirmed master customer). Loads the
//      scoped Customer 360 and returns the OTHER enquiries (siblings) + the merged
//      summary (both names / all phones / all emails, never overwriting) + the
//      merged date-wise timeline. This is the confirmed, full view.
//
//   2. ADVISORY — lead.customerId is NULL. Runs live duplicate detection against
//      the caller's SCOPED lead pool and surfaces a match ONLY at tier "Very High"
//      = same mobile OR same email (spec: name alone is NEVER a duplicate). Returns
//      a lighter advisory view (no merged timeline) so an admin can confirm/link.
//
// Visibility: every read is scoped via leadScopeWhere / getCustomer360, so an agent
// only ever sees their own sibling enquiries — never another owner's lead details.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere, type ScopedUser } from "@/lib/leadScope";
import { getCustomer360, type TimelineEvent } from "./query";
import { detectCandidates } from "./detect";
import { computeCustomerSummary, computeCustomerStatus } from "./compute";
import type { CustomerSummary, CustomerStatus, CustomerEnquiryInput } from "./types";

/** The minimal lead shape the returning-client resolver needs. */
export interface ReturningClientLead {
  id: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  altEmail: string | null;
  company: string | null;
  currentStatus: string | null;
  ownerId: string | null;
  createdAt: Date;
  customerId: string | null;
}

export interface SiblingEnquiry {
  id: string;
  name: string;
  currentStatus: string | null;
  ownerName: string | null;
  sourceLabel: string | null;
  createdAt: Date;
  forwardedTeam: string | null;
}

export interface ReturningClientView {
  /** true = confirmed master customer (linked); false = advisory (unconfirmed match). */
  isLinked: boolean;
  customerId: string | null;
  customerHref: string | null;
  /** Computed merged display name (linked only). */
  displayName: string | null;
  /** e.g. ["Same mobile", "Same email"] — the WHY. Only phone/email reasons. */
  matchReasons: string[];
  /** Live computed customer status. */
  status: CustomerStatus | null;
  /** Union rollup (both names/all phones/all emails) — never overwrites. */
  summary: CustomerSummary | null;
  /** The OTHER enquiries by the same customer (prev-vs-current). */
  siblings: SiblingEnquiry[];
  /** Merged date-wise timeline (linked only; empty for advisory). */
  timeline: TimelineEvent[];
}

/** Keep only the phone/email match reasons (never surface a name-only reason). */
function phoneEmailReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter((r) => /mobile|phone|email/i.test(r))));
}

export async function getReturningClientView(
  me: ScopedUser,
  lead: ReturningClientLead,
): Promise<ReturningClientView | null> {
  // ── 1. LINKED: the confirmed master customer ──────────────────────────────
  if (lead.customerId) {
    const c360 = await getCustomer360(me, lead.customerId);
    if (!c360) return null;
    const siblings = c360.enquiries.filter((e) => e.id !== lead.id);
    if (siblings.length === 0) return null; // only this enquiry is visible → no "returning" story
    return {
      isLinked: true,
      customerId: c360.id,
      customerHref: `/customers/${c360.id}`,
      displayName: c360.displayName,
      matchReasons: phoneEmailReasons(c360.confidence.reasons),
      status: c360.status,
      summary: c360.summary,
      siblings: siblings.map((s) => ({
        id: s.id, name: s.name, currentStatus: s.currentStatus, ownerName: s.ownerName,
        sourceLabel: s.sourceDetail ?? s.sourceRaw, createdAt: s.createdAt, forwardedTeam: s.forwardedTeam,
      })),
      timeline: c360.timeline,
    };
  }

  // ── 2. ADVISORY: not linked — is there a Very-High (phone/email) match? ─────
  const scope = await leadScopeWhere(me);
  const pool = await prisma.lead.findMany({
    where: { AND: [scope, { id: { not: lead.id } }] },
    select: {
      id: true, name: true, phone: true, altPhone: true, email: true, altEmail: true,
      company: true, currentStatus: true, ownerId: true, createdAt: true, forwardedTeam: true,
      sourceDetail: true, sourceRaw: true, owner: { select: { name: true } },
    },
    take: 5000,
  });
  const leadInput: CustomerEnquiryInput = {
    id: lead.id, currentStatus: lead.currentStatus, ownerId: lead.ownerId, name: lead.name,
    phone: lead.phone, altPhone: lead.altPhone, email: lead.email, altEmail: lead.altEmail, company: lead.company,
  };
  const matches = detectCandidates(
    leadInput,
    pool.map((p) => ({
      id: p.id, currentStatus: p.currentStatus, ownerId: p.ownerId, name: p.name,
      phone: p.phone, altPhone: p.altPhone, email: p.email, altEmail: p.altEmail, company: p.company,
    })),
  ).filter((m) => m.tier === "Very High"); // phone/email ONLY — never name-only
  if (matches.length === 0) return null;

  const byId = new Map(pool.map((p) => [p.id, p]));
  const matchedLeads = matches.map((m) => byId.get(m.matchedLeadId)).filter((p): p is (typeof pool)[number] => !!p);
  const inputs: CustomerEnquiryInput[] = [
    { ...leadInput, createdAt: lead.createdAt },
    ...matchedLeads.map((p) => ({
      id: p.id, currentStatus: p.currentStatus, ownerId: p.ownerId, name: p.name,
      phone: p.phone, altPhone: p.altPhone, email: p.email, altEmail: p.altEmail, company: p.company, createdAt: p.createdAt,
    })),
  ];
  return {
    isLinked: false,
    customerId: null,
    customerHref: null,
    displayName: null,
    matchReasons: phoneEmailReasons(matches.flatMap((m) => m.reasons)),
    status: computeCustomerStatus(inputs),
    summary: computeCustomerSummary(inputs),
    siblings: matchedLeads.map((p) => ({
      id: p.id, name: p.name, currentStatus: p.currentStatus, ownerName: p.owner?.name ?? null,
      sourceLabel: p.sourceDetail ?? p.sourceRaw, createdAt: p.createdAt, forwardedTeam: p.forwardedTeam,
    })),
    timeline: [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Customer layer — 360 data loader (Step 1 foundation, READ-ONLY).
//
// Loads ONE customer + its role-scoped enquiries and assembles the master
// timeline (every Activity across all the linked enquiries, plus the immutable
// link/unlink audit events). Returns the LIVE computed status / owner /
// confidence-reasons / summary alongside the raw enquiries — nothing here is
// stored; it is all recomputed per request from the linked enquiries.
//
// Visibility is enforced with leadScopeWhere(me): the enquiries sub-query is
// scoped so an agent sees only their own enquiries under the customer, a manager
// their team's, an admin all. A customer with NO visible enquiries → null
// (treated as not-found rather than disclosing existence).
//
// Events are NEVER removed — the UI filters them by category chip (Rule 4); this
// loader returns EVERY event tagged with its category so the client can filter.
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere, type ScopedUser } from "@/lib/leadScope";
import {
  computeCustomerStatus,
  computeCustomerOwner,
  computeCustomerConfidence,
  computeCustomerSummary,
} from "./compute";
import { isTerminalStatus, isBookedStatus } from "@/lib/lead-statuses";
import type { CustomerStatus, CustomerEnquiryInput, ConfidenceResult, CustomerSummary } from "./types";

/** Timeline event categories — drive the filter chips on the 360 view. */
export type TimelineCategory =
  | "call" | "whatsapp" | "note" | "assignment" | "ai" | "import"
  | "followup" | "merge" | "unlink" | "converted" | "rejected" | "other";

export interface TimelineEvent {
  id: string;
  /** Which enquiry this event belongs to (null for customer-level audit events). */
  leadId: string | null;
  at: Date;
  category: TimelineCategory;
  title: string;
  detail: string | null;
  /** Actor name when known. */
  by: string | null;
}

export interface EnquiryView {
  id: string;
  name: string;
  currentStatus: string | null;
  ownerId: string | null;
  ownerName: string | null;
  phone: string | null;
  email: string | null;
  sourceDetail: string | null;
  sourceRaw: string | null;
  createdAt: Date;
  forwardedTeam: string | null;
}

export interface Customer360 {
  id: string;
  displayName: string;
  canonicalOwnerId: string | null;
  status: CustomerStatus;
  /** Computed owner-of-record id, or "MULTIPLE". */
  ownerOfRecord: string;
  ownerOfRecordName: string | null;
  confidence: ConfidenceResult;
  summary: CustomerSummary;
  enquiries: EnquiryView[];
  timeline: TimelineEvent[];
  createdAt: Date;
}

/** Map an Activity row to a timeline category + readable title. */
function categorizeActivity(type: string, leadStatus: string | null): TimelineCategory {
  switch (type) {
    case "CALL": return "call";
    case "WHATSAPP": return "whatsapp";
    case "NOTE": return "note";
    case "ASSIGNMENT": return "assignment";
    case "LEAD_CREATED": return "import";
    case "REMINDER_FIRED": return "followup";
    case "STATUS_CHANGE":
      if (isBookedStatus(leadStatus)) return "converted";
      if (isTerminalStatus(leadStatus)) return "rejected";
      return "other";
    default: return "other";
  }
}

/**
 * Build the LIVE confidence factors for a customer from its own enquiries — do
 * the linked enquiries actually share a mobile / email / name / company? This is
 * the "why these enquiries are one customer" evidence, recomputed every load.
 */
function confidenceFromEnquiries(enquiries: CustomerEnquiryInput[]): ConfidenceResult {
  if (enquiries.length < 2) {
    // A single-enquiry customer has nothing to corroborate.
    return { score: 0, reasons: [] };
  }
  const last10 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

  const mobiles = enquiries.map((e) => last10(e.phone)).filter(Boolean);
  const emails = enquiries.flatMap((e) => [norm(e.email), norm(e.altEmail)]).filter(Boolean);
  const names = enquiries.map((e) => norm(e.name)).filter(Boolean);
  const companies = enquiries.map((e) => norm(e.company)).filter(Boolean);
  const altNums = enquiries.flatMap((e) => [last10(e.phone), last10(e.altPhone)]).filter(Boolean);

  const shared = (xs: string[]) => new Set(xs).size < xs.length; // a repeated value exists

  return computeCustomerConfidence({
    sameMobile: mobiles.length >= 2 && shared(mobiles),
    sameEmail: emails.length >= 2 && shared(emails),
    similarName: names.length >= 2 && shared(names),
    sameCompany: companies.length >= 2 && shared(companies),
    sameAlternateNumber: altNums.length >= 2 && shared(altNums) && !(mobiles.length >= 2 && shared(mobiles)),
  });
}

/**
 * Load the read-only Customer 360 for `customerId`, scoped to what `me` may see.
 * Returns null when the customer doesn't exist OR has no enquiry visible to the
 * caller (not-found rather than disclosing existence).
 */
export async function getCustomer360(me: ScopedUser, customerId: string): Promise<Customer360 | null> {
  const scope = await leadScopeWhere(me);

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true, displayName: true, canonicalOwnerId: true, createdAt: true,
      canonicalOwner: { select: { id: true, name: true } },
      enquiries: {
        where: scope,
        orderBy: { createdAt: "asc" },
        select: {
          id: true, name: true, currentStatus: true, ownerId: true,
          phone: true, altPhone: true, email: true, altEmail: true, company: true,
          sourceDetail: true, sourceRaw: true, createdAt: true, forwardedTeam: true,
          owner: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!customer) return null;
  if (customer.enquiries.length === 0) return null; // nothing visible → not-found

  const enquiryInputs: CustomerEnquiryInput[] = customer.enquiries.map((e) => ({
    id: e.id, currentStatus: e.currentStatus, ownerId: e.ownerId, name: e.name,
    phone: e.phone, altPhone: e.altPhone, email: e.email, altEmail: e.altEmail,
    company: e.company, sourceDetail: e.sourceDetail, sourceRaw: e.sourceRaw,
    createdAt: e.createdAt,
  }));

  const status = computeCustomerStatus(enquiryInputs);
  const ownerOfRecord = computeCustomerOwner(enquiryInputs, customer.canonicalOwnerId);
  const summary = computeCustomerSummary(enquiryInputs);
  const confidence = confidenceFromEnquiries(enquiryInputs);

  // Resolve the owner-of-record display name (canonical owner, or the single
  // shared enquiry owner; "MULTIPLE" has no single name).
  let ownerOfRecordName: string | null = null;
  if (ownerOfRecord !== "MULTIPLE") {
    ownerOfRecordName =
      customer.canonicalOwner?.name ??
      customer.enquiries.find((e) => e.ownerId === ownerOfRecord)?.owner?.name ??
      null;
  }

  const leadIds = customer.enquiries.map((e) => e.id);
  const statusById = new Map(customer.enquiries.map((e) => [e.id, e.currentStatus]));

  // ── Master timeline: every Activity across the linked enquiries ──
  const activities = leadIds.length
    ? await prisma.activity.findMany({
        where: { leadId: { in: leadIds } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, leadId: true, type: true, title: true, description: true,
          outcome: true, createdAt: true, completedAt: true, scheduledAt: true,
          user: { select: { name: true } },
        },
        take: 500,
      })
    : [];

  // ── Plus the immutable link/unlink audit events (merges / unlinks) ──
  const audits = await prisma.customerLinkAudit.findMany({
    where: { customerId: customer.id },
    orderBy: { performedAt: "desc" },
    select: {
      id: true, leadId: true, action: true, reason: true, performedAt: true,
      performedBy: { select: { name: true } },
    },
    take: 200,
  });

  const timeline: TimelineEvent[] = [
    ...activities.map((a) => ({
      id: `act_${a.id}`,
      leadId: a.leadId,
      at: a.completedAt ?? a.createdAt,
      category: categorizeActivity(a.type, statusById.get(a.leadId) ?? null),
      title: a.title,
      detail: a.outcome ? `${a.outcome}${a.description ? " — " + a.description : ""}` : a.description,
      by: a.user?.name ?? null,
    })),
    ...audits.map((au) => ({
      id: `lnk_${au.id}`,
      leadId: au.leadId,
      at: au.performedAt,
      category: (au.action === "UNLINK" ? "unlink" : "merge") as TimelineCategory,
      title: au.action === "UNLINK" ? "Enquiry unlinked from customer" : "Enquiry linked to customer",
      detail: au.reason ?? null,
      by: au.performedBy?.name ?? null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return {
    id: customer.id,
    displayName: customer.displayName,
    canonicalOwnerId: customer.canonicalOwnerId,
    status,
    ownerOfRecord,
    ownerOfRecordName,
    confidence,
    summary,
    enquiries: customer.enquiries.map((e) => ({
      id: e.id, name: e.name, currentStatus: e.currentStatus,
      ownerId: e.ownerId, ownerName: e.owner?.name ?? null,
      phone: e.phone, email: e.email, sourceDetail: e.sourceDetail,
      sourceRaw: e.sourceRaw, createdAt: e.createdAt, forwardedTeam: e.forwardedTeam,
    })),
    timeline,
    createdAt: customer.createdAt,
  };
}

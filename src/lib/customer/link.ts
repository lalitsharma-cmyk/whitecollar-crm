// ────────────────────────────────────────────────────────────────────────────
// Customer layer — LINK / UNLINK service (Step 1 foundation).
//
// The ONLY write path that sets or clears Lead.customerId. Every link/unlink:
//   1. updates Lead.customerId (link → target customer; unlink → null), and
//   2. writes ONE immutable CustomerLinkAudit row capturing the full decision
//      (who/when/why + confidence snapshot + match factors + owner/customer
//      transition), so the grouping is fully auditable and exactly reversible.
//
// REVERSIBILITY (Rule 7): unlink clears customerId and writes its own audit row,
// returning the enquiry to its EXACT prior standalone state (customerId = null).
// Re-linking restores it. The audit log is append-only and is never mutated.
//
// AUTH: ADMIN-only. The route authenticates + authorizes, then calls these. The
// in-transaction helpers take a `tx` client (like buyerLifecycle) so a whole
// link/unlink is atomic and the path is testable in a rolled-back transaction
// (no requireUser / no NextResponse inside the helper).
// ────────────────────────────────────────────────────────────────────────────

import "server-only";
// `Prisma` is imported as a VALUE (not just a type) because we use Prisma.JsonNull
// at runtime to write a SQL NULL into the nullable Json `matchFactors` column.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const LINK_ACTION = { LINK: "LINK", UNLINK: "UNLINK" } as const;
export type LinkAction = (typeof LINK_ACTION)[keyof typeof LINK_ACTION];

type Tx = Prisma.TransactionClient;

export interface LinkParams {
  leadId: string;
  /** Target customer to link under (LINK), or null to UNLINK (standalone). */
  targetCustomerId: string | null;
  /** Admin user id performing the action (for the audit row). */
  performedById: string;
  /** Optional free-text reason. */
  reason?: string | null;
  /** Live confidence score AT decision time (snapshot — never otherwise stored). */
  confidenceSnapshot?: number | null;
  /** Match factors that produced the score (audit JSON). */
  factors?: Prisma.InputJsonValue | null;
  /** Owner-of-record before/after (for the audit narrative). */
  previousOwnerId?: string | null;
  currentOwnerId?: string | null;
}

export interface LinkResult {
  leadId: string;
  action: LinkAction;
  prevCustomerId: string | null;
  newCustomerId: string | null;
  auditId: string;
}

/**
 * In-transaction core: set/clear Lead.customerId and append the immutable audit
 * row. Atomic with the caller's transaction. Does NOT authenticate — the caller
 * must already have proven the actor is an ADMIN and may touch this lead.
 */
export async function linkEnquiryInTx(tx: Tx, params: LinkParams): Promise<LinkResult> {
  const {
    leadId, targetCustomerId, performedById, reason,
    confidenceSnapshot, factors, previousOwnerId, currentOwnerId,
  } = params;

  // Read the enquiry's CURRENT customer membership so the audit captures the
  // exact transition (prev → new) — this is what makes the action reversible.
  const before = await tx.lead.findUnique({ where: { id: leadId }, select: { customerId: true } });
  if (!before) throw new Error(`linkEnquiry: lead ${leadId} not found`);

  const prevCustomerId = before.customerId ?? null;
  const newCustomerId = targetCustomerId ?? null;
  const action: LinkAction = newCustomerId ? LINK_ACTION.LINK : LINK_ACTION.UNLINK;

  // 1. Apply the membership change.
  await tx.lead.update({ where: { id: leadId }, data: { customerId: newCustomerId } });

  // 2. Append the immutable audit row. The customerId column on the audit points
  //    to the customer this decision CONCERNS (the target on LINK, the source we
  //    detached from on UNLINK) so the row is discoverable from either side.
  const audit = await tx.customerLinkAudit.create({
    data: {
      customerId: newCustomerId ?? prevCustomerId,
      leadId,
      action,
      performedById,
      reason: reason ?? null,
      confidenceSnapshot: confidenceSnapshot ?? null,
      matchFactors: factors ?? Prisma.JsonNull,
      previousOwnerId: previousOwnerId ?? null,
      currentOwnerId: currentOwnerId ?? null,
      prevCustomerId,
      newCustomerId,
      rollbackAvailable: true,
    },
    select: { id: true },
  });

  return { leadId, action, prevCustomerId, newCustomerId, auditId: audit.id };
}

/**
 * Link an enquiry to a customer (targetCustomerId) or unlink it (null), wrapping
 * the in-transaction core in its own transaction. ADMIN-only — the caller proves
 * authorization before invoking this.
 */
export async function linkEnquiry(params: LinkParams): Promise<LinkResult> {
  return prisma.$transaction((tx) => linkEnquiryInTx(tx, params));
}

/** Convenience: unlink an enquiry → returns it to standalone (customerId = null). */
export async function unlinkEnquiry(
  args: Omit<LinkParams, "targetCustomerId">,
): Promise<LinkResult> {
  return linkEnquiry({ ...args, targetCustomerId: null });
}

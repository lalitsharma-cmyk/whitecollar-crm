/**
 * UNIFIED LEAD COUNT SOURCE OF TRUTH
 *
 * Every count across the CRM (Master Data, Leads, Cold Calls, Dashboard, Reports)
 * MUST use these functions to ensure consistency. This is the single chokepoint
 * that keeps count chips and filter results in sync.
 *
 * BASE FILTERING RULES (applied to ALL counts):
 *   1. isColdCall: false (counts are for SALES leads; cold leads live in Revival Engine)
 *   2. deletedAt: null (deleted/archived records never counted in active views)
 *   3. Apply permission scope via leadScopeWhere(me) when role-specific
 *   4. Apply forwardedTeam filtering when team-specific
 *
 * INVARIANT: If a chip shows count N, clicking it must execute the same query.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TERMINAL_STATUSES, CLOSED_OUTCOME_STATUSES, LOST_STATUSES } from "@/lib/lead-statuses";
import { COLD_ORIGINS, ACTIVE_ORIGINS, WORKABLE_STATUS_OR } from "@/lib/leadScope";
import type { ScopedUser } from "@/lib/leadScope";
import { leadScopeWhere } from "@/lib/leadScope";

/**
 * Per-category WHERE fragments WITHOUT the permission scope.
 *
 * These are the single source of truth for each count's predicate. Both the
 * standalone count functions (which compose a fragment with their OWN
 * leadScopeWhere(me) call) and the batch functions (which resolve the scope
 * ONCE and reuse it) build on these, so the two paths can never drift.
 */
const CATEGORY_WHERE = {
  total: (): Prisma.LeadWhereInput => ({ isColdCall: false, deletedAt: null }),
  workable: (): Prisma.LeadWhereInput => ({ isColdCall: false, deletedAt: null, OR: WORKABLE_STATUS_OR }),
  closed: (): Prisma.LeadWhereInput => ({ isColdCall: false, deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } }),
  lost: (): Prisma.LeadWhereInput => ({ isColdCall: false, deletedAt: null, currentStatus: { in: LOST_STATUSES } }),
  deleted: (): Prisma.LeadWhereInput => ({
    isColdCall: false,
    deletedAt: { not: null },
    OR: [{ importBatchId: null }, { importBatch: { is: { status: { not: "DELETED" } } } }],
  }),
  archived: (): Prisma.LeadWhereInput => ({
    isColdCall: false,
    deletedAt: { not: null },
    importBatch: { is: { status: "DELETED" } },
  }),
  unassigned: (): Prisma.LeadWhereInput => ({
    isColdCall: false,
    deletedAt: null,
    ownerId: null,
    rejectedAt: null,
    OR: WORKABLE_STATUS_OR,
  }),
  awaitingTeam: (): Prisma.LeadWhereInput => ({
    isColdCall: false,
    deletedAt: null,
    forwardedTeam: null,
    leadOrigin: { in: ACTIVE_ORIGINS },
    OR: WORKABLE_STATUS_OR,
  }),
} as const;

/** Compose a category fragment with an ALREADY-RESOLVED permission scope. */
function withScope(base: Prisma.LeadWhereInput, scope: Prisma.LeadWhereInput): Prisma.LeadWhereInput {
  return { ...base, ...scope };
}

/**
 * Count SALES leads (not cold-call, not deleted) visible to the user.
 * This is the baseline for all Master Data / Leads / Dashboard counts.
 */
export async function countTotalSalesLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.total(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count WORKABLE leads (not deleted, not cold-call, not terminal status).
 * This is the primary "Active / Actionable" view for Master Data and Leads.
 *
 * Workable = status is null/blank OR not in TERMINAL_STATUSES.
 * This feeds the "Active / Workable" tab in Master Data and the default Leads view.
 */
export async function countWorkableLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.workable(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count leads with CLOSED OUTCOMES (booked, sold, leased, etc.).
 * These are "won" deals that leave the working pipeline.
 */
export async function countClosedLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.closed(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count leads with LOST / REJECTED status (not interested, broker, etc.).
 * These are explicitly rejected and no longer actionable.
 */
export async function countLostLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.lost(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count leads with a specific status.
 * Used by filter tabs and detail screens.
 */
export async function countByStatus(
  status: string | string[],
  me?: ScopedUser
): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    currentStatus: Array.isArray(status) ? { in: status } : { equals: status, mode: "insensitive" },
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Count UNASSIGNED leads (ownerId is null).
 * These are operational counters for triage/assignment queues.
 *
 * NOTE: This counts unassigned leads that are WORKABLE (not deleted, not cold-call).
 * Archived/deleted unassigned leads don't count.
 */
export async function countUnassignedLeads(me?: ScopedUser): Promise<number> {
  // rejectedAt:null (in the fragment) → rejected = unassigned-for-history, NOT ready to assign.
  const where = withScope(CATEGORY_WHERE.unassigned(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count leads AWAITING TEAM ASSIGNMENT (forwardedTeam is null).
 * These are leads that came in but haven't been routed to Dubai/India yet.
 *
 * NOTE: Awaiting team means no team is set, so the lead is unclassified/untriaged.
 * Only counts workable leads (not deleted, not cold-call).
 */
export async function countAwaitingTeamLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.awaitingTeam(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count leads by team (Dubai / India).
 * Master Data and Dashboard use this to segment views.
 */
export async function countByTeam(team: string, me?: ScopedUser): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    forwardedTeam: team,
    OR: WORKABLE_STATUS_OR,
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Count deleted leads (soft-deleted via deletedAt, for Recycle Bin view).
 * NEVER included in any active count.
 */
export async function countDeletedLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.deleted(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Count archived leads (soft-deleted as part of a rolled-back import batch).
 * NEVER included in any active count.
 */
export async function countArchivedLeads(me?: ScopedUser): Promise<number> {
  const where = withScope(CATEGORY_WHERE.archived(), me ? await leadScopeWhere(me) : {});
  return prisma.lead.count({ where });
}

/**
 * Batch count for Master Data category tabs.
 * Returns all 6 counts in one query for efficiency.
 */
export async function countMasterDataCategories(me?: ScopedUser) {
  // Resolve the permission scope ONCE and reuse it across all 6 counts. Previously
  // each count called leadScopeWhere(me) independently, so for a MANAGER the
  // WITH RECURSIVE org walk ran 6×/load; now it runs once. ADMIN/AGENT resolve to a
  // trivial scope either way, so they're unaffected. Counts are byte-identical —
  // each composes the SAME CATEGORY_WHERE fragment the standalone count uses.
  const scope: Prisma.LeadWhereInput = me ? await leadScopeWhere(me) : {};
  const [all, workable, closed, lost, deleted, archived] = await Promise.all([
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.total(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.workable(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.closed(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.lost(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.deleted(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.archived(), scope) }),
  ]);
  return { all, workable, closed, lost, deleted, archived };
}

/**
 * Batch count for assignment operations (management view).
 * Returns unassigned + awaiting team counts used by Master Data header and Dashboard.
 */
export async function countAssignmentQueues(me?: ScopedUser) {
  // Resolve the permission scope ONCE (see countMasterDataCategories) — a MANAGER's
  // org CTE otherwise ran twice here. Counts stay identical (same fragments).
  const scope: Prisma.LeadWhereInput = me ? await leadScopeWhere(me) : {};
  const [unassigned, awaitingTeam] = await Promise.all([
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.unassigned(), scope) }),
    prisma.lead.count({ where: withScope(CATEGORY_WHERE.awaitingTeam(), scope) }),
  ]);
  return { unassigned, awaitingTeam };
}

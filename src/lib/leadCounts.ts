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
 * Count SALES leads (not cold-call, not deleted) visible to the user.
 * This is the baseline for all Master Data / Leads / Dashboard counts.
 */
export async function countTotalSalesLeads(me?: ScopedUser): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    ...(me ? await leadScopeWhere(me) : {}),
  };
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
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    OR: WORKABLE_STATUS_OR,
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Count leads with CLOSED OUTCOMES (booked, sold, leased, etc.).
 * These are "won" deals that leave the working pipeline.
 */
export async function countClosedLeads(me?: ScopedUser): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    currentStatus: { in: CLOSED_OUTCOME_STATUSES },
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Count leads with LOST / REJECTED status (not interested, broker, etc.).
 * These are explicitly rejected and no longer actionable.
 */
export async function countLostLeads(me?: ScopedUser): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    currentStatus: { in: LOST_STATUSES },
    ...(me ? await leadScopeWhere(me) : {}),
  };
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
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    ownerId: null,
    OR: WORKABLE_STATUS_OR,
    ...(me ? await leadScopeWhere(me) : {}),
  };
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
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: null,
    forwardedTeam: null,
    leadOrigin: { in: ACTIVE_ORIGINS },
    OR: WORKABLE_STATUS_OR,
    ...(me ? await leadScopeWhere(me) : {}),
  };
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
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: { not: null },
    OR: [{ importBatchId: null }, { importBatch: { is: { status: { not: "DELETED" } } } }],
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Count archived leads (soft-deleted as part of a rolled-back import batch).
 * NEVER included in any active count.
 */
export async function countArchivedLeads(me?: ScopedUser): Promise<number> {
  const where: Prisma.LeadWhereInput = {
    isColdCall: false,
    deletedAt: { not: null },
    importBatch: { is: { status: "DELETED" } },
    ...(me ? await leadScopeWhere(me) : {}),
  };
  return prisma.lead.count({ where });
}

/**
 * Batch count for Master Data category tabs.
 * Returns all 6 counts in one query for efficiency.
 */
export async function countMasterDataCategories(me?: ScopedUser) {
  const [all, workable, closed, lost, deleted, archived] = await Promise.all([
    countTotalSalesLeads(me),
    countWorkableLeads(me),
    countClosedLeads(me),
    countLostLeads(me),
    countDeletedLeads(me),
    countArchivedLeads(me),
  ]);
  return { all, workable, closed, lost, deleted, archived };
}

/**
 * Batch count for assignment operations (management view).
 * Returns unassigned + awaiting team counts used by Master Data header and Dashboard.
 */
export async function countAssignmentQueues(me?: ScopedUser) {
  const [unassigned, awaitingTeam] = await Promise.all([
    countUnassignedLeads(me),
    countAwaitingTeamLeads(me),
  ]);
  return { unassigned, awaitingTeam };
}

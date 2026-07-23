// ════════════════════════════════════════════════════════════════════════════
// EMPLOYEE OFFBOARDING — the reusable engine behind Admin → User Management →
// "Mark as Left Organization" (Lalit 2026-07-23). Generalises the one-off Yasir
// Khan offboarding (scripts/offboard-yasir-2026-07-23.ts) into a repeatable,
// preview-first, reversible action.
//
// DESIGN — `active` is the enforcement flag, employmentStatus is the reason.
// Every access + routing check already keys off User.active (login, roster/
// dropdown filters, the round-robin picker's active:true, and the assignLeadTo
// InactiveUserError guard). So offboarding to a non-working state simply sets
// active=false and the whole stack enforces it — no routing engine needs to learn
// about employmentStatus. This enum records WHY (left / suspended / disabled) and
// gives LEFT_ORGANIZATION its terminal semantics. ON_LEAVE is the exception: it
// keeps active=true (the person is covered by leave-cover, not locked out).
//
// PRESERVES ALL HISTORY. Ownership moves; call logs, activities, notes, audit,
// Previous-Owner and assignment history are never touched. Reversible via a
// snapshot OperationLog row.
// ════════════════════════════════════════════════════════════════════════════
import { prisma } from "@/lib/prisma";
import type { EmploymentStatus, Prisma } from "@prisma/client";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit } from "@/lib/audit";

/** The non-ACTIVE states. All EXCEPT ON_LEAVE lock the account (active=false). */
export const LOCKOUT_STATUSES: EmploymentStatus[] = ["TEMPORARILY_DISABLED", "SUSPENDED", "LEFT_ORGANIZATION"];
export function statusLocksAccount(s: EmploymentStatus): boolean {
  return (LOCKOUT_STATUSES as string[]).includes(s);
}
/** LEFT_ORGANIZATION is terminal — reactivation must be an explicit admin act. */
export const TERMINAL_EMPLOYMENT: EmploymentStatus = "LEFT_ORGANIZATION";

// Non-terminal status envelope for "leads this user still owns that must be
// reassigned". A bare `currentStatus: { notIn: TERMINAL_STATUSES }` silently DROPS
// null/blank-status leads in Postgres (a NULL is neither IN nor NOT IN a set) — which
// stranded 147 null-status REVIVAL leads with an offboarded user on 2026-07-23 (the
// engine's own preview + verify shared the buggy predicate, so it read "0" and failed
// silently). These legs keep FRESH/REVIVAL (null/blank) leads eligible. Mirrors
// leadScope.WORKABLE_STATUS_OR; kept local to avoid widening this server module's
// import surface (same pattern as freshLeads.ts / dashboardWidgets.ts).
const NON_TERMINAL_STATUS_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: [...TERMINAL_STATUSES] } },
];

export interface WorkloadPreview {
  activeLeads: number;       // owned, non-terminal, not deleted (Leads + Master)
  revivalLeads: number;      // of the above, cold/revival origin
  leadsWithFollowup: number;
  assignedBuyers: number;    // ASSIGNED buyer records
  plannedActivities: number; // future tasks/reminders
  liveSessions: number;
  total: number;             // reassignable records (leads + buyers)
}

/** Read-only workload the offboarding would move — shown in the confirm preview
 *  BEFORE anything is written (spec: "require a confirmation preview with exact
 *  affected counts"). */
export async function offboardingWorkloadPreview(userId: string): Promise<WorkloadPreview> {
  // Non-terminal, non-deleted leads this user still owns — ALL origins (Leads,
  // Revival, Cold, Master-Data) get reassigned on offboarding. The status predicate
  // is NON_TERMINAL_STATUS_OR (null/blank INCLUDED); it lives under `OR`, so callers
  // that need their own OR must nest it under AND to avoid clobbering it (below).
  const ownerScope = { ownerId: userId, deletedAt: null } as const;
  const [activeLeads, revivalLeads, leadsWithFollowup, assignedBuyers, plannedActivities, liveSessions] =
    await Promise.all([
      prisma.lead.count({ where: { ...ownerScope, OR: NON_TERMINAL_STATUS_OR } }),
      // revival subset — TWO ORs (status + origin) combined under AND so neither clobbers the other.
      prisma.lead.count({ where: { ...ownerScope, AND: [{ OR: NON_TERMINAL_STATUS_OR }, { OR: [{ leadOrigin: { in: ["COLD", "REVIVAL"] } }, { isColdCall: true }] }] } }),
      prisma.lead.count({ where: { ...ownerScope, followupDate: { not: null }, OR: NON_TERMINAL_STATUS_OR } }),
      prisma.buyerRecord.count({ where: { ownerId: userId, deletedAt: null, poolStatus: "ASSIGNED" } }).catch(() => 0),
      prisma.activity.count({ where: { userId, status: "PLANNED" } }).catch(() => 0),
      prisma.userSession.count({ where: { userId, revokedAt: null } }).catch(() => 0),
    ]);
  return { activeLeads, revivalLeads, leadsWithFollowup, assignedBuyers, plannedActivities, liveSessions, total: activeLeads + assignedBuyers };
}

export type ReassignMode = "admin_queue" | "reassign_user";

export interface OffboardInput {
  targetUserId: string;
  actorId: string;
  status: EmploymentStatus;      // usually LEFT_ORGANIZATION
  lastWorkingDate?: Date | null;
  reason?: string | null;
  note?: string | null;
  reassignMode: ReassignMode;
  reassignToUserId?: string | null; // required when reassignMode = reassign_user
}

export interface OffboardResult {
  ok: boolean;
  error?: string;
  status?: EmploymentStatus;
  accountLocked?: boolean;
  sessionsRevoked?: number;
  leadsMoved?: number;
  buyersMoved?: number;
  reassignedTo?: string | null;
  operationLogId?: string | null;
}

/**
 * Execute an offboarding. Locks the account (for lockout statuses), reassigns the
 * active workload, preserves Previous-Owner + all history, writes a reversible
 * OperationLog row and an audit entry. Idempotent-ish: re-running on an already
 * offboarded user with no active workload is a no-op beyond re-stamping status.
 */
export async function offboardUser(input: OffboardInput): Promise<OffboardResult> {
  const { targetUserId, actorId, status, reassignMode } = input;
  const now = new Date();

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, active: true, isSuperAdmin: true } });
  if (!target) return { ok: false, error: "User not found" };
  if (target.id === actorId) return { ok: false, error: "You cannot offboard your own account." };

  // Resolve the reassignment target up front (fail fast on a bad choice).
  let reassignTo: { id: string; name: string } | null = null;
  if (reassignMode === "reassign_user") {
    if (!input.reassignToUserId) return { ok: false, error: "Pick a user to reassign the workload to." };
    if (input.reassignToUserId === targetUserId) return { ok: false, error: "Cannot reassign to the person being offboarded." };
    const to = await prisma.user.findUnique({ where: { id: input.reassignToUserId }, select: { id: true, name: true, active: true } });
    if (!to) return { ok: false, error: "Reassignment target not found." };
    if (!to.active) return { ok: false, error: `${to.name} is not active — pick an active user.` };
    reassignTo = { id: to.id, name: to.name };
  }

  const locks = statusLocksAccount(status);

  // ── 1. ACCOUNT STATE ──
  await prisma.user.update({
    where: { id: targetUserId },
    data: {
      employmentStatus: status,
      lastWorkingDate: input.lastWorkingDate ?? null,
      offboardReason: input.reason ?? null,
      offboardNote: input.note ?? null,
      offboardedById: actorId,
      offboardedAt: locks ? now : null,
      // Lockout statuses disable access + kill sessions; ON_LEAVE keeps active.
      ...(locks ? { active: false, sessionEpoch: { increment: 1 }, passwordChangedAt: now } : { active: true }),
    },
  });
  let sessionsRevoked = 0;
  if (locks) {
    const r = await prisma.userSession.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: now, revokedReason: "offboarded" } });
    sessionsRevoked = r.count;
    await prisma.presenceSession.deleteMany({ where: { userId: targetUserId } }).catch(() => {});
  }

  // ── 2 + 3. REASSIGN WORKLOAD — LOCKOUT statuses ONLY. ON_LEAVE keeps the person's
  //   book: they still hold their leads/buyers (leave-cover redirects only NEW
  //   assignments). Moving anything here would silently strip an on-leave agent — the
  //   UI hides the reassign controls for ON_LEAVE and says "keeps access", so the
  //   backend must not move anything either. Only a lockout (LEFT/SUSPENDED/DISABLED)
  //   hands the active book to the Admin Queue + returns buyers to the Admin Pool. ──
  let leadsMoved = 0;
  let buyersMoved = 0;
  let operationLogId: string | null = null;
  if (locks) {
    // Snapshot BEFORE mutation (reversal source). NON_TERMINAL_STATUS_OR keeps
    // null/blank-status (FRESH/REVIVAL) leads in scope — a bare `notIn` dropped them
    // once and stranded 147 leads with a locked-out user (RCA 2026-07-23).
    const activeLeads = await prisma.lead.findMany({
      where: { ownerId: targetUserId, deletedAt: null, OR: NON_TERMINAL_STATUS_OR },
      select: { id: true, ownerId: true, previousOwnerId: true, assignedAt: true, followupDate: true },
    });
    const beforeState = activeLeads.map((l) => ({ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt, followupDate: l.followupDate }));

    for (const l of activeLeads) {
      try {
        if (reassignMode === "reassign_user" && reassignTo) {
          // assignLeadTo resets the SLA/attempt cycle, reactivates a LOST lead, and
          // refuses an inactive target — the same choke point every assign uses.
          await assignLeadTo(l.id, reassignTo.id, `offboarding reassign from ${target.name}`);
        } else {
          // Admin Queue — unassign, keep Previous Owner = the offboarded user.
          await prisma.lead.update({
            where: { id: l.id },
            data: { ownerId: null, previousOwnerId: l.ownerId ?? l.previousOwnerId, assignedAt: null, returnedToPoolAt: now, followupDate: null, followupReminderSentAt: null },
          });
        }
        leadsMoved++;
      } catch { /* skip a single failure, keep going — reported in the count */ }
    }

    // Buyers keep their own pool lifecycle; a former owner's records go back to ADMIN_POOL.
    const buyerRes = await prisma.buyerRecord.updateMany({
      where: { ownerId: targetUserId, deletedAt: null, poolStatus: "ASSIGNED" },
      data: { ownerId: null, poolStatus: "ADMIN_POOL", assignedAt: null, returnedToPoolAt: now },
    }).catch(() => ({ count: 0 }));
    buyersMoved = buyerRes.count;

    // ── 4. OperationLog (reversible) ──
    try {
      const op = await prisma.operationLog.create({
        data: {
          operation: "lead.transfer", entityType: "Lead", module: "Offboarding",
          field: "ownerId",
          summary: `Offboard ${target.name} (${status}) — ${leadsMoved} leads → ${reassignTo ? reassignTo.name : "Admin Queue"}${buyersMoved ? `, ${buyersMoved} buyers → Admin Pool` : ""}`,
          status: "EXECUTED", affectedCount: leadsMoved, affectedIds: activeLeads.map((l) => l.id),
          beforeState, afterState: { reassignMode, reassignToUserId: reassignTo?.id ?? null }, createdById: actorId,
        },
        select: { id: true },
      });
      operationLogId = op.id;
    } catch { /* OperationLog is best-effort; the audit below is the durable record */ }
  }

  await audit({
    userId: actorId, action: "user.offboard", entity: "User", entityId: targetUserId,
    meta: { status, reassignMode, reassignToUserId: reassignTo?.id ?? null, leadsMoved, buyersMoved, sessionsRevoked, accountLocked: locks },
  }).catch(() => {});

  return { ok: true, status, accountLocked: locks, sessionsRevoked, leadsMoved, buyersMoved, reassignedTo: reassignTo?.name ?? null, operationLogId };
}

/**
 * Reactivate a former/suspended user — admin-only, audited. Clears the offboarding
 * stamps and re-enables access. A LEFT_ORGANIZATION user does NOT regain access
 * automatically anywhere; only this explicit call restores it.
 */
export async function reactivateUser(targetUserId: string, actorId: string): Promise<OffboardResult> {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, employmentStatus: true } });
  if (!target) return { ok: false, error: "User not found" };
  await prisma.user.update({
    where: { id: targetUserId },
    data: { employmentStatus: "ACTIVE", active: true, offboardedAt: null, lastWorkingDate: null, offboardReason: null, offboardNote: null, offboardedById: null },
  });
  await audit({
    userId: actorId, action: "user.reactivate", entity: "User", entityId: targetUserId,
    meta: { fromStatus: target.employmentStatus },
  }).catch(() => {});
  return { ok: true, status: "ACTIVE", accountLocked: false };
}

// Centralised "which buyers can this user see?" logic for the Buyer Data
// pipeline. Mirrors src/lib/leadScope.ts, but buyers are scoped by OWNERSHIP
// (BuyerRecord has no forwardedTeam — it's a worked pool, not a team-tagged
// repository), and an agent only ever sees their OWN, currently-ASSIGNED buyers.
//
// Rules:
//   ADMIN / super-admin → every buyer (pool + all agents'). No filter.
//   MANAGER             → buyers owned by anyone in their org sub-tree
//                         (themselves + direct/indirect reports), regardless of
//                         poolStatus, so a manager can see what their agents are
//                         working. They do NOT see the unassigned Admin Pool.
//   AGENT               → ONLY buyers where ownerId === self AND
//                         poolStatus === "ASSIGNED". They never see the pool,
//                         other agents' buyers, or their own once it's been
//                         CONVERTED / REJECTED / returned to pool.
//
// Out-of-scope rows are treated as not-found (404), never 403 — the API must not
// confirm a buyer exists to someone who shouldn't see it.

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface BuyerScopedUser { id: string; role: Role; team?: string | null; }

/**
 * User ids whose buyers `me` may see.
 *   ADMIN   → null  ("no owner filter")
 *   MANAGER → [me.id, ...direct & indirect reports]  (one Postgres CTE)
 *   AGENT   → [me.id]
 */
export async function visibleBuyerOwnerIds(me: BuyerScopedUser): Promise<string[] | null> {
  if (me.role === "ADMIN") return null;
  if (me.role === "AGENT") return [me.id];
  // MANAGER — recursive org walk (same shape as leadScope.visibleOwnerIds).
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE org AS (
      SELECT id FROM "User" WHERE id = ${me.id}
      UNION ALL
      SELECT u.id FROM "User" u INNER JOIN org ON u."managerId" = org.id
    )
    SELECT id FROM org
  `;
  return rows.map((r) => r.id);
}

export interface BuyerScopeWhere {
  ownerId?: { in: string[] } | string;
  poolStatus?: string;
  deletedAt?: null;
}

/**
 * Prisma where-fragment to scope a BuyerRecord list/count to what `me` may see.
 *   ADMIN   → { deletedAt: null } (all live buyers, incl. the unassigned Admin Pool)
 *   MANAGER → { ownerId: { in: <org subtree> }, deletedAt: null } (their agents' buyers)
 *   AGENT   → { ownerId: me.id, poolStatus: "ASSIGNED", deletedAt: null } (own assigned only)
 *
 * EVERY branch excludes soft-deleted (recycle-bin) records — a deleted buyer never
 * appears in any list / pool / count / rollup. Use this in EVERY buyer read so an
 * agent can reach /buyer-data for their assigned buyers without ever seeing the
 * pool, a colleague's buyer, or a deleted one.
 */
export async function buyerScopeWhere(me: BuyerScopedUser): Promise<BuyerScopeWhere> {
  if (me.role === "ADMIN") return { deletedAt: null };
  if (me.role === "AGENT") return { ownerId: me.id, poolStatus: "ASSIGNED", deletedAt: null };
  // MANAGER — their org subtree's owned buyers (any pool status).
  const ids = await visibleBuyerOwnerIds(me);
  if (ids === null) return { deletedAt: null };
  if (ids.length === 1) return { ownerId: ids[0], deletedAt: null };
  return { ownerId: { in: ids }, deletedAt: null };
}

/** True if `me` may access this specific buyer. Same rules as buyerScopeWhere,
 *  evaluated against one loaded record. A soft-deleted (recycle-bin) buyer is
 *  untouchable by everyone — restoring it goes through the dedicated bulk
 *  restore path, not the normal detail/edit/lifecycle routes. */
export async function canTouchBuyer(
  me: BuyerScopedUser,
  buyer: { ownerId: string | null; poolStatus: string; deletedAt?: Date | null },
): Promise<boolean> {
  if (buyer.deletedAt) return false;
  if (me.role === "ADMIN") return true;
  if (me.role === "AGENT") return buyer.ownerId === me.id && buyer.poolStatus === "ASSIGNED";
  // MANAGER — owner must be in their org subtree.
  const ids = await visibleBuyerOwnerIds(me);
  return ids === null || (buyer.ownerId !== null && ids.includes(buyer.ownerId));
}

/** Convenience: true if the user is an admin (the only role that may manage the
 *  pool — import/export/assign-from-pool). Mirrors the existing admin gate. */
export function isBuyerAdmin(me: { role: Role }): boolean {
  return me.role === "ADMIN";
}

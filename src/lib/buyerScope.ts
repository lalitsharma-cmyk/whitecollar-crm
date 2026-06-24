// Centralised "which buyers can this user see?" logic for the DUBAI BUYER DATA
// pipeline. Mirrors src/lib/leadScope.ts, but buyers are scoped by OWNERSHIP
// (BuyerRecord has no forwardedTeam — it's a worked pool, not a team-tagged
// repository), an agent only ever sees their OWN, currently-ASSIGNED buyers, AND
// the whole module is MARKET-SCOPED to Dubai.
//
// ── MARKET SCOPE (Dubai Buyer Data) ──────────────────────────────────────────
// This module is "Dubai Buyer Data": ONLY Dubai-market buyers (market="Dubai")
// are ever shown, and ONLY Dubai-team users + admins may see / be assigned them.
// A FUTURE Gurgaon/India Buyer Data module is a SEPARATE module (its own market
// value e.g. "Gurgaon", its own pages, its own assignment rules) — do NOT widen
// these helpers into a shared all-markets system. The `market: DUBAI_MARKET`
// filter + the Dubai-team gate below are the seam.
//
// Rules (within the Dubai market):
//   ADMIN / super-admin → every Dubai buyer (pool + all agents'). No owner filter.
//   Dubai-team MANAGER  → Dubai buyers owned by anyone in their org sub-tree
//                         (themselves + direct/indirect reports), regardless of
//                         poolStatus. They do NOT see the unassigned Admin Pool.
//   Dubai-team AGENT    → ONLY Dubai buyers where ownerId === self AND
//                         poolStatus === "ASSIGNED".
//   NON-Dubai agent/mgr → NO ACCESS (India/Gurgaon teams are excluded entirely —
//                         their where-clause is forced to match nothing, and the
//                         page guards redirect them away + hide the nav item).
//
// Out-of-scope rows are treated as not-found (404), never 403 — the API must not
// confirm a buyer exists to someone who shouldn't see it.

import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeTeam } from "@/lib/teamRouting";

/** The market this module is scoped to. The single source of truth — every buyer
 *  read pins this. A future Gurgaon module would define its own constant. */
export const DUBAI_MARKET = "Dubai" as const;

export interface BuyerScopedUser { id: string; role: Role; team?: string | null; }

/** True if this user belongs to the Dubai team (team normalises to "Dubai"). */
export function isDubaiTeamUser(me: { team?: string | null }): boolean {
  return normalizeTeam(me.team) === "Dubai";
}

/** True if this user may access Dubai Buyer Data AT ALL: an ADMIN/super-admin, OR
 *  a Dubai-team user (AGENT/MANAGER). India/Gurgaon-team + HR/non-sales users are
 *  excluded. This is the single gate for page access, nav visibility, and the
 *  assignment pool. NOT name-based — driven off role + team. */
export function canAccessDubaiBuyers(me: { role: Role; team?: string | null }): boolean {
  if (me.role === "ADMIN") return true;
  return isDubaiTeamUser(me);
}

/** True if a user is a VALID assignment target for a Dubai buyer: a Dubai-team
 *  user OR an admin. Used to filter the assign roster (UI) AND to reject a
 *  tampered server-side assignment to a non-Dubai, non-admin user. */
export function isDubaiAssignable(u: { role?: Role | string | null; team?: string | null }): boolean {
  if (u.role === "ADMIN") return true;
  return normalizeTeam(u.team) === "Dubai";
}

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
  market: string;
  ownerId?: { in: string[] } | string;
  poolStatus?: string;
  deletedAt?: null;
  // When set false-y via this impossible id, the clause matches NOTHING (used to
  // hard-exclude a non-Dubai agent who somehow reaches a scoped read).
  id?: string;
}

/** The market filter every Dubai-buyer read shares. Merge into any where. */
export function dubaiBuyerWhere<T extends Record<string, unknown>>(extra?: T): T & { market: string } {
  return { ...(extra ?? ({} as T)), market: DUBAI_MARKET };
}

/**
 * Prisma where-fragment to scope a BuyerRecord list/count to what `me` may see,
 * ALWAYS pinned to the Dubai market.
 *   ADMIN        → { market:"Dubai", deletedAt: null } (all live Dubai buyers, incl. pool)
 *   Dubai MGR    → { market:"Dubai", ownerId:{in:<org subtree>}, deletedAt:null }
 *   Dubai AGENT  → { market:"Dubai", ownerId: me.id, poolStatus:"ASSIGNED", deletedAt:null }
 *   NON-Dubai    → matches NOTHING (id="__no_access__") — they have no access.
 *
 * EVERY branch excludes soft-deleted (recycle-bin) records AND non-Dubai-market
 * buyers. Use this in EVERY buyer read so the Dubai module only ever shows Dubai
 * buyers, and a non-Dubai agent can never see a row.
 */
export async function buyerScopeWhere(me: BuyerScopedUser): Promise<BuyerScopeWhere> {
  // Hard gate: a non-Dubai, non-admin user gets an impossible filter.
  if (!canAccessDubaiBuyers(me)) {
    return { market: DUBAI_MARKET, deletedAt: null, id: "__no_access__" };
  }
  if (me.role === "ADMIN") return { market: DUBAI_MARKET, deletedAt: null };
  if (me.role === "AGENT") return { market: DUBAI_MARKET, ownerId: me.id, poolStatus: "ASSIGNED", deletedAt: null };
  // MANAGER (Dubai) — their org subtree's owned Dubai buyers (any pool status).
  const ids = await visibleBuyerOwnerIds(me);
  if (ids === null) return { market: DUBAI_MARKET, deletedAt: null };
  if (ids.length === 1) return { market: DUBAI_MARKET, ownerId: ids[0], deletedAt: null };
  return { market: DUBAI_MARKET, ownerId: { in: ids }, deletedAt: null };
}

/** True if `me` may access this specific buyer. Same rules as buyerScopeWhere,
 *  evaluated against one loaded record. Enforces: (1) the user can access Dubai
 *  buyers at all, (2) the record is Dubai-market, (3) it's not soft-deleted, and
 *  (4) ownership/role scope. A soft-deleted (recycle-bin) buyer is untouchable by
 *  everyone — restoring it goes through the dedicated bulk restore path. */
export async function canTouchBuyer(
  me: BuyerScopedUser,
  buyer: { ownerId: string | null; poolStatus: string; deletedAt?: Date | null; market?: string | null },
): Promise<boolean> {
  if (buyer.deletedAt) return false;
  // Market gate: this module only ever touches Dubai-market buyers. A record
  // loaded WITHOUT a market selected (older callers) is treated as in-scope only
  // when the caller didn't ask — but every caller in this module selects market.
  if (buyer.market != null && buyer.market !== DUBAI_MARKET) return false;
  if (!canAccessDubaiBuyers(me)) return false;
  if (me.role === "ADMIN") return true;
  if (me.role === "AGENT") return buyer.ownerId === me.id && buyer.poolStatus === "ASSIGNED";
  // MANAGER (Dubai) — owner must be in their org subtree.
  const ids = await visibleBuyerOwnerIds(me);
  return ids === null || (buyer.ownerId !== null && ids.includes(buyer.ownerId));
}

/** Convenience: true if the user is an admin (the only role that may manage the
 *  pool — import/export/assign-from-pool). Mirrors the existing admin gate. */
export function isBuyerAdmin(me: { role: Role }): boolean {
  return me.role === "ADMIN";
}

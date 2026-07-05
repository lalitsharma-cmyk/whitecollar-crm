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

/** The Dubai market constant (kept for the many existing Dubai call-sites). */
export const DUBAI_MARKET = "Dubai" as const;
export const INDIA_MARKET = "India" as const;

/** Buyer-Data markets. Dubai (AED/M) and India (INR/Cr) are SEPARATE modules over the
 *  same BuyerRecord table, distinguished by the `market` column. Each is scoped to its
 *  own team; a Dubai agent can never see India buyers and vice-versa. */
export type BuyerMarket = "Dubai" | "India";

/** The sales TEAM that owns a buyer market (Dubai market ↔ Dubai team; India ↔ India). */
export function teamForBuyerMarket(market: BuyerMarket): "Dubai" | "India" {
  return market === "India" ? "India" : "Dubai";
}

export interface BuyerScopedUser { id: string; role: Role; team?: string | null; }

/** True if this user belongs to the Dubai team (team normalises to "Dubai"). */
export function isDubaiTeamUser(me: { team?: string | null }): boolean {
  return normalizeTeam(me.team) === "Dubai";
}

/** True if `me` may access buyers of THIS market at all: an ADMIN/super-admin, OR a
 *  user whose team matches the market's team. The single gate for page access, nav
 *  visibility and the assignment pool, per market. Role+team driven (never name-based). */
export function canAccessBuyerMarket(me: { role: Role; team?: string | null }, market: BuyerMarket): boolean {
  if (me.role === "ADMIN") return true;
  return normalizeTeam(me.team) === teamForBuyerMarket(market);
}

/** True if this user may access Dubai Buyer Data AT ALL. Thin wrapper over
 *  canAccessBuyerMarket("Dubai") — Dubai behaviour is byte-identical (admin or Dubai team). */
export function canAccessDubaiBuyers(me: { role: Role; team?: string | null }): boolean {
  return canAccessBuyerMarket(me, DUBAI_MARKET);
}

/** True if a user is a VALID assignment target for a buyer of THIS market: an admin,
 *  OR a user whose team matches the market's team. Used to filter the assign roster (UI)
 *  AND to reject a tampered server-side assignment to a wrong-market, non-admin user. */
export function isBuyerAssignableForMarket(u: { role?: Role | string | null; team?: string | null }, market: BuyerMarket): boolean {
  if (u.role === "ADMIN") return true;
  return normalizeTeam(u.team) === teamForBuyerMarket(market);
}

/** True if a user is a valid assignment target for a DUBAI buyer. Thin wrapper. */
export function isDubaiAssignable(u: { role?: Role | string | null; team?: string | null }): boolean {
  return isBuyerAssignableForMarket(u, DUBAI_MARKET);
}

/** The buyer market a record belongs to (legacy rows without a market → Dubai). */
export function marketOfBuyer(buyer: { market?: string | null }): BuyerMarket {
  return buyer.market === INDIA_MARKET ? "India" : "Dubai";
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
export async function buyerScopeWhereForMarket(me: BuyerScopedUser, market: BuyerMarket): Promise<BuyerScopeWhere> {
  // Hard gate: a user whose team doesn't own this market (and isn't admin) gets an
  // impossible filter — pinned to the market so it can NEVER match another market's rows.
  if (!canAccessBuyerMarket(me, market)) {
    return { market, deletedAt: null, id: "__no_access__" };
  }
  if (me.role === "ADMIN") return { market, deletedAt: null };
  if (me.role === "AGENT") return { market, ownerId: me.id, poolStatus: "ASSIGNED", deletedAt: null };
  // MANAGER — their org subtree's owned buyers in this market (any pool status).
  const ids = await visibleBuyerOwnerIds(me);
  if (ids === null) return { market, deletedAt: null };
  if (ids.length === 1) return { market, ownerId: ids[0], deletedAt: null };
  return { market, ownerId: { in: ids }, deletedAt: null };
}

/** Dubai scope — thin wrapper (byte-identical to the original). Every existing Dubai
 *  call-site keeps working unchanged; India uses buyerScopeWhereForMarket(me,"India"). */
export async function buyerScopeWhere(me: BuyerScopedUser): Promise<BuyerScopeWhere> {
  return buyerScopeWhereForMarket(me, DUBAI_MARKET);
}

/** CROSS-MARKET, ownership-scoped buyer filter for GLOBAL SEARCH — finds a user's
 *  buyers across Dubai AND India in one query (the module wheres are market-pinned;
 *  search is not). Market access is respected automatically because it keys off
 *  OWNERSHIP, not market:
 *    ADMIN   → every live buyer (both markets, incl. pool).
 *    AGENT   → ONLY their own currently-ASSIGNED buyers (which only exist in their
 *              own market anyway) — never another agent's, never another market's.
 *    MANAGER → buyers owned by their org sub-tree (their team ⇒ their market).
 *  Always excludes soft-deleted rows. Use for read-only search surfaces only. */
export async function buyerSearchScope(
  me: BuyerScopedUser,
): Promise<{ ownerId?: { in: string[] } | string; poolStatus?: string; deletedAt: null }> {
  if (me.role === "ADMIN") return { deletedAt: null };
  if (me.role === "AGENT") return { deletedAt: null, ownerId: me.id, poolStatus: "ASSIGNED" };
  const ids = await visibleBuyerOwnerIds(me);
  if (ids === null) return { deletedAt: null };
  return { deletedAt: null, ownerId: ids.length === 1 ? ids[0] : { in: ids } };
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
  // Market gate: derive the buyer's market (legacy rows without a market → Dubai) and
  // require `me` to have access to THAT market. A Dubai buyer + Dubai/admin user is
  // byte-identical to before; a cross-market touch (Dubai user ↔ India buyer, or the
  // reverse) can NEVER pass — no passport/financial data crosses the market seam.
  const buyerMarket: BuyerMarket = buyer.market === INDIA_MARKET ? "India" : "Dubai";
  if (!canAccessBuyerMarket(me, buyerMarket)) return false;
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

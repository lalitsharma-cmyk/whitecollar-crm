// Centralised "can this user touch this lead?" logic. Used by every endpoint
// that reads or mutates a single lead, and by list queries to scope results.
//
// Rules (with manager hierarchy):
//   ADMIN              → see and act on every lead (no team filter)
//   MANAGER            → see/act on leads whose forwardedTeam matches their team
//                        (team-scoped: a Dubai manager ONLY sees Dubai leads)
//   AGENT              → only leads they own (ownerId === me.id)
//
// Anything outside that scope is treated as not-found (404) rather than
// forbidden (403), so the API doesn't confirm existence to outsiders.

import type { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { SUPPRESSED_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";

export interface ScopedUser { id: string; role: Role; team?: string | null; }

/**
 * Returns the set of user ids whose leads `me` is allowed to see.
 *   ADMIN → null (means "no filter")
 *   MANAGER → [me.id, ...direct & indirect reports]
 *   AGENT → [me.id]
 *
 * The recursive report-of-report walk runs as one Postgres CTE for speed.
 */
export async function visibleOwnerIds(me: ScopedUser): Promise<string[] | null> {
  if (me.role === "ADMIN") return null;
  if (me.role === "AGENT") return [me.id];
  // MANAGER — recursive walk via CTE
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE org AS (
      SELECT id FROM "User" WHERE id = ${me.id}
      UNION ALL
      SELECT u.id FROM "User" u INNER JOIN org ON u."managerId" = org.id
    )
    SELECT id FROM org
  `;
  return rows.map(r => r.id);
}

/** Where-clause fragment to filter a lead list by ownership AND (for MANAGERs) by team.
 *
 * ADMIN:   no filter — sees all leads across both teams.
 * MANAGER: team-scoped — ONLY sees leads whose forwardedTeam matches normalizeTeam(me.team).
 *          This is STRICT: a Dubai manager cannot see India leads, even if the India agent
 *          reports to them. Team comes from the LEAD's market, never from phone/geo.
 * AGENT:   ownership-scoped — only leads they own (ownerId === me.id).
 */
export async function leadScopeWhere(
  me: ScopedUser,
): Promise<{ ownerId?: { in: string[] } | string; forwardedTeam?: string; deletedAt?: null }> {
  // Soft-deleted leads (rolled-back imports) are hidden from EVERY scoped list
  // and count. This single chokepoint keeps a deleted import batch invisible
  // across leads / dashboard / reports without touching each query. Restore
  // (clearing Lead.deletedAt) brings them straight back.
  const ids = await visibleOwnerIds(me);
  if (ids === null) {
    // ADMIN — no ownership restrictions, but still hide soft-deleted leads.
    return { deletedAt: null };
  }
  if (me.role === "MANAGER") {
    // Team-scoped: only leads in the manager's team. If the manager has no
    // team set, fall back to the owner-id walk (graceful degradation) so the
    // manager still sees SOMETHING rather than an empty page.
    const team = normalizeTeam(me.team ?? undefined);
    if (team) {
      return { forwardedTeam: team, deletedAt: null };
    }
    // Fallback: no team configured — use the old owner-id scope
  }
  // AGENT or MANAGER without a team configured
  if (ids.length === 1) return { ownerId: ids[0], deletedAt: null };
  return { ownerId: { in: ids }, deletedAt: null };
}

/** True if the user is allowed to access this specific lead. */
export async function canTouchLead(
  me: ScopedUser,
  lead: { ownerId: string | null; forwardedTeam?: string | null },
): Promise<boolean> {
  if (me.role === "ADMIN") return true;
  if (me.role === "AGENT") return lead.ownerId === me.id;
  // MANAGER — team-scoped first (strict).
  // If manager has a team, only leads in that team are visible.
  const team = normalizeTeam(me.team ?? undefined);
  if (team) {
    const leadTeam = normalizeTeam(lead.forwardedTeam);
    // Leads without a team are NOT visible to managers (awaiting classification).
    return leadTeam === team;
  }
  // Manager has no team configured — fall back to owner-tree check.
  const ids = await visibleOwnerIds(me);
  return ids === null || (lead.ownerId !== null && ids.includes(lead.ownerId));
}

/**
 * Helper for API routes that need: "fetch the lead OR return 404 if the
 * caller can't see it". Returns { me, lead } on success, or a NextResponse
 * to be returned by the route on failure.
 */
export async function loadOwnedLead(leadId: string): Promise<
  | { me: Awaited<ReturnType<typeof requireUser>>; lead: { id: string; ownerId: string | null; phone: string | null; name: string; forwardedTeam: string | null }; error?: undefined }
  | { error: NextResponse; me?: undefined; lead?: undefined }
> {
  const me = await requireUser();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, phone: true, name: true, forwardedTeam: true },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  if (!(await canTouchLead(me, lead))) {
    // 404, not 403 — don't confirm the lead exists to someone who shouldn't see it
    return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  }
  return { me, lead };
}

// ─── CANONICAL COUNT HELPERS — the SINGLE source of truth for lead counts ───────
// Every screen (Dashboard, Leads, Profile, Team, Team-detail, Reports, Scoreboards,
// Leaderboards) MUST count "active" / "won" leads through these. No page-specific
// denylist/allowlist, and deletedAt:null is ALWAYS applied. Use leadScopeWhere(me)
// + ACTIVE_STATUS_WHERE for role-scoped counts, or ownerActiveWhere(id) for a
// specific agent (Profile / Team / Team-detail / Scoreboards).

/** Canonical status fragment for ACTIVE leads. Combine with a scope or an ownerId. */
export const ACTIVE_STATUS_WHERE = { currentStatus: { notIn: SUPPRESSED_STATUSES } };
/** Canonical status fragment for WON/booked deals — the one deal-closing definition.
 *  Bookings only (both casings), NOT the broad CLOSED_OUTCOME lifecycle list, so a
 *  resale / lease / bought-elsewhere outcome can never inflate a "deals closed" KPI. */
export const WON_STATUS_WHERE = { currentStatus: { in: BOOKED_STATUSES } };

/** A specific owner's ACTIVE, non-deleted leads (Profile / Team / Team-detail / Scoreboards). */
export function ownerActiveWhere(ownerId: string) {
  return { ownerId, deletedAt: null, currentStatus: { notIn: SUPPRESSED_STATUSES } };
}
/** A specific owner's total non-deleted leads, any status. */
export function ownerTotalWhere(ownerId: string) {
  return { ownerId, deletedAt: null };
}
/** A specific owner's WON/booked (both casings), non-deleted deals. */
export function ownerWonWhere(ownerId: string) {
  return { ownerId, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } };
}

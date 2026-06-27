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

import type { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { SUPPRESSED_STATUSES, TERMINAL_STATUSES, BOOKED_STATUSES } from "@/lib/lead-statuses";

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

// leadOrigin is the SECTION authority: a record belongs to exactly one of
// Leads / Revival / Master-Data. Cold + Revival origins live in the Revival
// Engine ONLY and must never count toward Leads / Dashboard / Team / Profile /
// Reports active metrics unless explicitly promoted. ("COLD" is the current
// legacy value; "REVIVAL" is the canonical name — exclude both so the fix holds
// across the upcoming leadOrigin migration.)
export const COLD_ORIGINS = ["COLD", "REVIVAL"];
// Phase D vocabulary: every lead belongs to exactly ONE section by leadOrigin.
//   ACTIVE pipeline (Leads/Dashboard/Team/Reports) → ACTIVE_LEAD (legacy "ACTIVE")
//   Revival Engine                                  → REVIVAL    (legacy "COLD")
//   Master Data repository ONLY (untriaged imports) → MASTER_DATA (legacy PORTFOLIO/SYSTEM)
// We accept BOTH the legacy and the new value during/after the migration so there
// is no breakage window. Active is now an ALLOW-LIST (not "anything but cold"),
// so freshly-imported MASTER_DATA records stay out of Leads until explicitly moved.
export const ACTIVE_ORIGINS = ["ACTIVE", "ACTIVE_LEAD"];
export const MASTER_DATA_ORIGINS = ["MASTER_DATA", "PORTFOLIO", "SYSTEM"];
/** Canonical fragment: only ACTIVE-pipeline records participate in lead metrics. */
export const ACTIVE_ORIGIN_WHERE = { leadOrigin: { in: ACTIVE_ORIGINS } };

/** Canonical status fragment for ACTIVE leads. Combine with a scope or an ownerId. */
export const ACTIVE_STATUS_WHERE = { currentStatus: { notIn: SUPPRESSED_STATUSES } };
/** Canonical status fragment for WON/booked deals — the one deal-closing definition.
 *  Bookings only (both casings), NOT the broad CLOSED_OUTCOME lifecycle list, so a
 *  resale / lease / bought-elsewhere outcome can never inflate a "deals closed" KPI. */
export const WON_STATUS_WHERE = { currentStatus: { in: BOOKED_STATUSES } };

/** A specific owner's ACTIVE, non-deleted, non-cold leads (Profile / Team / Team-detail / Scoreboards).
 *  Delegates to the canonical activeLeadWhere so an agent's "active leads" number is
 *  IDENTICAL here and on every reporting surface (leaderboard / reports / team /
 *  agent-performance). The status envelope is the broad non-terminal one (not just
 *  SUPPRESSED), so a Lost/Booked lead is excluded from "active" consistently. */
export function ownerActiveWhere(ownerId: string) {
  return activeLeadWhere({ ownerId });
}
/** A specific owner's total non-deleted, non-cold leads, any status (cold lives in Revival, not the agent's book). */
export function ownerTotalWhere(ownerId: string) {
  return { ownerId, deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS } };
}
/** A specific owner's WON/booked (both casings), non-deleted deals. */
export function ownerWonWhere(ownerId: string) {
  return { ownerId, deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS }, currentStatus: { in: BOOKED_STATUSES } };
}

// ── Follow-up reconciliation (Dashboard ⇄ Leads — single counting source) ──────
// "Workable" = a scope + non-cold/revival origin + a status that is NOT closed/lost
// (TERMINAL_STATUSES). The Dashboard follow-up tiles (Overdue / Upcoming) and the
// Leads follow-up chip counts MUST both count through this identical envelope so an
// agent's "Overdue" tile equals the Leads "Overdue" chip 1:1. The 53-vs-33 mismatch
// was: the Dashboard excluded only the 7 SUPPRESSED statuses while Leads excluded
// the ~40 TERMINAL ones, and the Leads chips were missing the cold/revival exclusion.
export const WORKABLE_STATUS_OR = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];
export function workableWhere<T extends Prisma.LeadWhereInput>(scope: T): Prisma.LeadWhereInput {
  return { ...scope, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR };
}

// ── CANONICAL "operational ACTIVE lead" definition (Jun26 — owner-approved) ─────
// The SINGLE source of truth for "active operational lead", used by EVERY
// per-agent / team "active leads" metric on the reporting surfaces
// (/reports/leaderboard, /reports, /team, /reports/agent-performance, /profile,
// /team/[id]). An active operational lead is ALL of:
//   1. leadOrigin in ACTIVE_ORIGINS  — NOT cold/revival, NOT master-data. Master
//      Data is a repository, not active until promoted (this is the ALLOW-LIST,
//      which is why it differs from the old `leadOrigin notIn COLD` that WRONGLY
//      counted untriaged MASTER_DATA imports as active — the 245-lead gap).
//   2. deletedAt: null               — recycle-bin / rolled-back imports never count.
//   3. currentStatus is WORKABLE     — NOT terminal (Rejected/Lost/Not-Interested/
//      Duplicate/Invalid/Dead/Blacklisted/Junk + booked/sold/leased). Expressed via
//      WORKABLE_STATUS_OR so null/blank (FRESH) leads stay eligible. Mirrors
//      ownerActiveWhere's status semantics but the canonical helper uses the broad
//      non-terminal envelope (not just SUPPRESSED) so a Lost/Booked lead is excluded
//      from "active" consistently across all surfaces.
//
// Spread a scope (e.g. { ownerId } for one agent, or leadScopeWhere(me) for a
// role-scoped count, or {} for a global total) and combine. Because deletedAt and
// leadOrigin are top-level keys and the status predicate is an OR, callers that
// need their OWN top-level OR must nest it under AND (none currently do).
export function activeLeadWhere<T extends Prisma.LeadWhereInput>(scope?: T): Prisma.LeadWhereInput {
  return {
    ...(scope ?? ({} as T)),
    deletedAt: null,
    leadOrigin: { in: ACTIVE_ORIGINS },
    OR: WORKABLE_STATUS_OR,
  };
}

// ── ACTIVE FOLLOW-UP BOARD definition (Jun26 — the SINGLE source of truth) ──────
// "What appears on the Active Follow-up Board?" The board (Action List), the Leads
// follow-up chips, and the Dashboard follow-up widgets MUST all agree on this one
// definition so the Action-List ⇄ Leads-chip reconciliation holds. A lead is on the
// Active Board iff ALL of:
//   1. NOT cold/revival origin           (those live in the Revival Engine)
//   2. NOT terminal/rejected             (isTerminalStatus → off the board; a
//      rejected lead that still carries a follow-up is a REVISIT, surfaced on the
//      separate Revisit Queue, never here). Expressed via WORKABLE_STATUS_OR, which
//      keeps null/blank statuses (FRESH) eligible.
//   3. NOT a MASTER_DATA-origin lead UNLESS it is BOTH assigned (ownerId != null)
//      AND scheduled (followupDate != null). Untriaged Master-Data imports must not
//      flood the board; only a Master-Data lead that has been given an owner and a
//      follow-up date earns a place.
//
// Note: rules 2 & 3 layer ON TOP of workableWhere's envelope (rules 1 + 2). The new
// piece is rule 3 (the Master-Data gate). We combine the two status/origin ORs under
// AND so they never collide with a caller's own top-level OR (e.g. the Leads search
// OR), and we preserve any AND already present on the incoming scope.
export const MASTER_DATA_BOARD_OR: Prisma.LeadWhereInput[] = [
  // Not a Master-Data lead → eligible on its own (subject to the other rules).
  { leadOrigin: { notIn: MASTER_DATA_ORIGINS } },
  // Master-Data lead → only when BOTH assigned AND scheduled.
  { AND: [{ ownerId: { not: null } }, { followupDate: { not: null } }] },
];

/**
 * The canonical "Active Follow-up Board" envelope. Spread a scope (e.g.
 * leadScopeWhere(me), or { deletedAt:null, ... }) and this returns the where that
 * every board-equivalent surface (Action List, Leads follow-up chips, Dashboard
 * follow-up widgets) must use. Callers still add their own followupDate window on
 * top. Collision-safe: status + master-data gates live under AND, so a caller may
 * keep its own top-level OR.
 */
export function activeBoardWhere<T extends Prisma.LeadWhereInput>(scope: T): Prisma.LeadWhereInput {
  const existingAnd = Array.isArray(scope.AND) ? scope.AND : scope.AND ? [scope.AND] : [];
  return {
    ...scope,
    leadOrigin: { notIn: COLD_ORIGINS },
    rejectedAt: null,   // a rejected lead is off the board regardless of a stale workable status (Lalit 2026-06-28)
    AND: [
      ...existingAnd,
      { OR: WORKABLE_STATUS_OR },     // rule 2: not terminal (null/blank kept)
      { OR: MASTER_DATA_BOARD_OR },   // rule 3: master-data only if assigned+scheduled
    ],
  };
}

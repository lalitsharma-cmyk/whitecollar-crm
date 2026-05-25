// Centralised "can this user touch this lead?" logic. Used by every endpoint
// that reads or mutates a single lead, and by list queries to scope results.
//
// Rules (with manager hierarchy):
//   ADMIN              → see and act on every lead
//   MANAGER            → see/act on own leads + every lead owned by a DIRECT REPORT
//                        (recursive — also includes reports-of-reports)
//   AGENT              → only leads they own (ownerId === me.id)
//
// Anything outside that scope is treated as not-found (404) rather than
// forbidden (403), so the API doesn't confirm existence to outsiders.

import type { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export interface ScopedUser { id: string; role: Role; }

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

/** Where-clause fragment to filter a lead list by ownership. */
export async function leadScopeWhere(me: ScopedUser): Promise<{ ownerId?: { in: string[] } | string }> {
  const ids = await visibleOwnerIds(me);
  if (ids === null) return {};
  if (ids.length === 1) return { ownerId: ids[0] };
  return { ownerId: { in: ids } };
}

/** True if the user is allowed to access this specific lead. */
export async function canTouchLead(me: ScopedUser, lead: { ownerId: string | null }): Promise<boolean> {
  if (me.role === "ADMIN") return true;
  if (lead.ownerId === me.id) return true;
  if (me.role === "AGENT") return false;
  // MANAGER — check that the lead's owner is in their report tree
  const ids = await visibleOwnerIds(me);
  return ids === null || (lead.ownerId !== null && ids.includes(lead.ownerId));
}

/**
 * Helper for API routes that need: "fetch the lead OR return 404 if the
 * caller can't see it". Returns { me, lead } on success, or a NextResponse
 * to be returned by the route on failure.
 */
export async function loadOwnedLead(leadId: string): Promise<
  | { me: Awaited<ReturnType<typeof requireUser>>; lead: { id: string; ownerId: string | null; phone: string | null; name: string }; error?: undefined }
  | { error: NextResponse; me?: undefined; lead?: undefined }
> {
  const me = await requireUser();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, phone: true, name: true },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  if (!(await canTouchLead(me, lead))) {
    // 404, not 403 — don't confirm the lead exists to someone who shouldn't see it
    return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  }
  return { me, lead };
}

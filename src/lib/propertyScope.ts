// Property visibility scoping — agents see only their team's geography.
//
// Rules:
//   ADMIN / MANAGER         → see everything (no filter).
//   AGENT with team "Dubai" → Project.country === "UAE"
//   AGENT with team "India" → Project.country === "India"
//   AGENT with team "HQ"    → see everything (HQ is non-sales, treat as admin-ish).
//   AGENT with NULL team    → see everything (don't cripple new hires before tagged).
//
// In a Lead context, prefer the lead's forwardedTeam over the user's team —
// a lead handed off cross-team (rare) should drive the picker's filter.
// A lead with NULL forwardedTeam falls back to "show all" (it's still in the
// admin queue / triage anyway).
//
// All other team labels (e.g. legacy "uae", typos) map to null, which means
// "no filter" — safer than hiding everything.

import type { Prisma, Role } from "@prisma/client";

/** Map a User.team value to the matching Project.country value. */
export function teamToCountry(team: string | null | undefined): string | null {
  if (!team) return null;
  if (team === "Dubai") return "UAE";
  if (team === "India") return "India";
  // "HQ" and anything else → null = no country filter.
  return null;
}

/** Minimal user shape needed for scoping decisions. */
export interface PropertyScopeUser {
  role: Role;
  team: string | null;
}

/**
 * Where-clause fragment to filter projects by the calling user's team.
 *   ADMIN / MANAGER → {} (see all)
 *   AGENT with mapped team → { country: <mapped> }
 *   AGENT with HQ / null / unmapped → {} (see all — don't cripple)
 */
export function projectWhereForUser(user: PropertyScopeUser): Prisma.ProjectWhereInput {
  if (user.role === "ADMIN" || user.role === "MANAGER") return {};
  const country = teamToCountry(user.team);
  if (!country) return {};
  return { country };
}

/**
 * Where-clause fragment for project lists shown in a lead context (pickers,
 * CMA comparables, etc.). Uses the lead's `forwardedTeam` so a Dubai lead
 * picked up by an India agent (or unassigned) still shows Dubai projects.
 *
 * Admin/Manager bypass. Null forwardedTeam → no filter (lead is in admin queue).
 */
export function projectWhereForLead(
  lead: { forwardedTeam: string | null },
  user: PropertyScopeUser,
): Prisma.ProjectWhereInput {
  if (user.role === "ADMIN" || user.role === "MANAGER") return {};
  const country = teamToCountry(lead.forwardedTeam);
  if (!country) return {};
  return { country };
}

/**
 * Server-side guard for MUTATIONS / DETAIL access (attach a project to a lead,
 * open a project page). Returns true if `user` may touch a project of
 * `projectCountry`. UI filtering is bypassable via direct API/URL, so the
 * write/detail endpoints must call this.
 *
 *   ADMIN / MANAGER             → always true (cross-market is intentional).
 *   AGENT                       → projectCountry must equal the agent's allowed
 *                                 country (the lead's market if given, else the
 *                                 agent's own team). Unknown market on either
 *                                 side → true (fail-open, matches the where-helpers;
 *                                 prod has no null-country projects / null-team agents).
 */
export function userCanAccessProjectCountry(
  user: PropertyScopeUser,
  projectCountry: string | null | undefined,
  lead?: { forwardedTeam: string | null } | null,
): boolean {
  if (user.role === "ADMIN" || user.role === "MANAGER") return true;
  const allowed = teamToCountry(lead?.forwardedTeam ?? null) ?? teamToCountry(user.team);
  if (!allowed) return true;        // HQ / untagged agent → don't cripple
  if (!projectCountry) return true; // unknown-market project → don't block (rare)
  return projectCountry === allowed;
}

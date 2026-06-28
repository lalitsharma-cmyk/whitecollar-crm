// ─────────────────────────────────────────────────────────────────────────────
// HR CRM — CENTRALISED AUTHORIZATION (pure / isomorphic).
//
// The single source of truth for "what can this HR user do?". Pure functions
// only (no prisma, no server-only) so the SAME rules drive both server-side API
// guards (src/lib/hrAccess.ts) and client-side UI hiding (buttons/nav). UI
// hiding alone is never sufficient — every server route re-checks via hrAccess.
//
// Roles are DERIVED from the existing Role enum + hrOnly/hrTeam flags (no new
// enum value, no migration, no impact on Sales):
//   ADMIN      = role ADMIN                         → full unrestricted access
//   SENIOR_HR  = hrTeam, OR (hrOnly && MANAGER)     → Nisha: all candidates, assign,
//                                                      reports, escalation review, voice
//                                                      guidance; NOT system settings
//   JUNIOR_HR  = hrOnly && (AGENT or other)         → only assigned candidates; no
//                                                      reports/settings/import/export/
//                                                      user-mgmt; voice ESCALATION only
//   null       = not an HR user (Sales-only) → no HR access at all
// ─────────────────────────────────────────────────────────────────────────────
import type { Prisma, Role } from "@prisma/client";

export type HrRole = "ADMIN" | "SENIOR_HR" | "JUNIOR_HR";

/** Minimal user shape needed to resolve HR role — safe to pass to the client. */
export interface HrUserLite {
  id: string;
  role: Role;
  hrOnly?: boolean | null;
  hrTeam?: boolean | null;
}

/** Resolve the HR role, or null if the user is not an HR user at all. */
export function hrRoleOf(u: HrUserLite | null | undefined): HrRole | null {
  if (!u) return null;
  if (u.role === "ADMIN") return "ADMIN";
  if (u.hrTeam) return "SENIOR_HR";
  if (u.hrOnly && u.role === "MANAGER") return "SENIOR_HR";
  if (u.hrOnly) return "JUNIOR_HR";
  return null;
}

export function isHrUser(u: HrUserLite | null | undefined): boolean {
  return hrRoleOf(u) !== null;
}

// ── Permission matrix ────────────────────────────────────────────────────────
export interface HrPermissions {
  /** See every candidate (false → only candidates assigned to me). */
  viewAllCandidates: boolean;
  /** Assign / reassign candidate ownership. */
  assign: boolean;
  /** Access the Reports section + analytics. */
  reports: boolean;
  /** Import candidates (Excel/CSV). */
  importData: boolean;
  /** Export candidate data (CSV). */
  exportData: boolean;
  /** Grant/revoke HR access, deactivate HR members. */
  manageUsers: boolean;
  /** Access HR settings (non-system). */
  settings: boolean;
  /** Admin-only system-level settings. */
  systemSettings: boolean;
  /** Record manager voice GUIDANCE on a candidate (Admin + Senior HR). */
  sendVoiceGuidance: boolean;
  /** Raise a voice ESCALATION to a manager (everyone, incl. Junior HR). */
  raiseEscalation: boolean;
  /** Review / reply to escalations (Admin + Senior HR). */
  reviewEscalations: boolean;
  /** Delete a candidate. */
  deleteCandidate: boolean;
  /** Bulk actions on the candidate table. */
  bulkActions: boolean;
}

const ADMIN_PERMS: HrPermissions = {
  viewAllCandidates: true, assign: true, reports: true, importData: true, exportData: true,
  manageUsers: true, settings: true, systemSettings: true, sendVoiceGuidance: true,
  raiseEscalation: true, reviewEscalations: true, deleteCandidate: true, bulkActions: true,
};

const SENIOR_HR_PERMS: HrPermissions = {
  viewAllCandidates: true, assign: true, reports: true, importData: true, exportData: true,
  manageUsers: false, settings: true, systemSettings: false, sendVoiceGuidance: true,
  raiseEscalation: true, reviewEscalations: true, deleteCandidate: true, bulkActions: true,
};

const JUNIOR_HR_PERMS: HrPermissions = {
  viewAllCandidates: false, assign: false, reports: false, importData: false, exportData: false,
  manageUsers: false, settings: false, systemSettings: false, sendVoiceGuidance: false,
  raiseEscalation: true, reviewEscalations: false, deleteCandidate: false, bulkActions: false,
};

const NONE_PERMS: HrPermissions = {
  viewAllCandidates: false, assign: false, reports: false, importData: false, exportData: false,
  manageUsers: false, settings: false, systemSettings: false, sendVoiceGuidance: false,
  raiseEscalation: false, reviewEscalations: false, deleteCandidate: false, bulkActions: false,
};

export function permissionsFor(role: HrRole | null): HrPermissions {
  switch (role) {
    case "ADMIN": return ADMIN_PERMS;
    case "SENIOR_HR": return SENIOR_HR_PERMS;
    case "JUNIOR_HR": return JUNIOR_HR_PERMS;
    default: return NONE_PERMS;
  }
}

/** Convenience: resolve a user's permissions in one call. */
export function hrPermissionsOf(u: HrUserLite | null | undefined): HrPermissions {
  return permissionsFor(hrRoleOf(u));
}

export function hrCan(u: HrUserLite | null | undefined, perm: keyof HrPermissions): boolean {
  return hrPermissionsOf(u)[perm];
}

// ── Candidate visibility scope ───────────────────────────────────────────────
/**
 * Prisma where-fragment that limits a candidate list to what `me` may see.
 *   ADMIN / SENIOR_HR → {} (all candidates)
 *   JUNIOR_HR         → only candidates they primary/secondary own
 *   non-HR            → impossible match (sees nothing)
 * Spread into any HRCandidate query: `where: { ...hrScopeWhere(me), status: ... }`.
 */
export function hrScopeWhere(u: HrUserLite | null | undefined): Prisma.HRCandidateWhereInput {
  const role = hrRoleOf(u);
  if (role === "ADMIN" || role === "SENIOR_HR") return {};
  if (role === "JUNIOR_HR" && u) {
    return { OR: [{ primaryOwnerId: u.id }, { secondaryOwnerId: u.id }] };
  }
  // Not an HR user — match nothing.
  return { id: "__no_access__" };
}

/** True if `me` may read/act on this specific candidate. */
export function canTouchCandidate(
  u: HrUserLite | null | undefined,
  candidate: { primaryOwnerId?: string | null; secondaryOwnerId?: string | null },
): boolean {
  const role = hrRoleOf(u);
  if (role === null) return false;
  if (role === "ADMIN" || role === "SENIOR_HR") return true;
  return candidate.primaryOwnerId === u!.id || candidate.secondaryOwnerId === u!.id;
}

/** Short human label for the HR role (badges / settings). */
export function hrRoleLabel(role: HrRole | null): string {
  switch (role) {
    case "ADMIN": return "Admin";
    case "SENIOR_HR": return "Senior HR";
    case "JUNIOR_HR": return "Junior HR";
    default: return "—";
  }
}

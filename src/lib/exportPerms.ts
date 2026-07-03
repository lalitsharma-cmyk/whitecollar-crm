// Sensitive data export / import — OWNER-ONLY (Super Admin).
//
// Lalit's RBAC decision (2026-07-03): raw lead/customer data must NEVER leave the
// CRM except by the owner. Export/import of Leads, Master Data, Dubai + India Buyer
// Data, Revival, Reports, and Call Logs is allowed ONLY for Super Admins
// (Lalit + the Super-Admin account) — a regular ADMIN (e.g. Sameer), MANAGER, or
// AGENT must NOT be able to export/import, even by hitting the URL/API directly.
//
// This ONE predicate is the single source of truth:
//   • server routes call canExportData(me) → 403 when false (the security boundary);
//   • the UI hides every export/import control behind the same check (UX).
// isSuperAdmin is a flag on the User (a Super Admin is an ADMIN with the flag);
// verified: Lalit = true, Sameer = false.

export function canExportData(me: { isSuperAdmin?: boolean | null } | null | undefined): boolean {
  return me?.isSuperAdmin === true;
}

/** Import shares the exact same boundary as export (owner-only). */
export const canImportData = canExportData;

/** Uniform denial message for the 403 body. */
export const EXPORT_DENIED = "Restricted: data export/import is available to the owner (Super Admin) only.";

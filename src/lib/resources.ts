// ────────────────────────────────────────────────────────────────────────────
// Gallery / Resource Library — shared constants + pure helpers.
//
// Each Resource is EXACTLY ONE of: FILE (uploaded bytes), URL (external link),
// TEXT (text template). This module holds the upload caps, the allowed MIME
// allow-list, the category vocabulary, and small pure helpers used by both the
// API routes and the UI. NO "server-only" import so it can be unit-tested by the
// regression harness.
// ────────────────────────────────────────────────────────────────────────────

/** Hard cap for an uploaded file. No blob backend exists — bytes live in
 *  Postgres bytea, so keep rows small. 5 MB matches the brief. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/** MIME types allowed for FILE uploads — images + PDF only (shareable
 *  marketing collateral). Anything else is rejected at upload time. */
export const ALLOWED_MIME_PREFIXES = ["image/"] as const;
export const ALLOWED_MIME_EXACT = ["application/pdf"] as const;

/** True when `mime` is an allowed upload type (image/* or application/pdf). */
export function isAllowedMime(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase().split(";")[0].trim();
  if (ALLOWED_MIME_EXACT.includes(m as (typeof ALLOWED_MIME_EXACT)[number])) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p));
}

/** Common category vocabulary. Free string in the DB — admins can add more — but
 *  the picker offers these by default. */
export const RESOURCE_CATEGORIES = [
  "Brochure",
  "Payment Plan",
  "Creative",
  "Image",
  "PDF",
  "Floor Plan",
  "Price List",
  "Template",
  "Other",
] as const;

export type ResourceTypeStr = "FILE" | "URL" | "TEXT";
export type ResourceChannelStr = "WHATSAPP" | "EMAIL" | "ATTACH";

/** ADMIN + MANAGER can manage ANY resource (view all, edit/delete/categorize
 *  any row). This is the "manage everything" capability — distinct from the
 *  per-resource owner check below. */
export function canManageResources(role: string | null | undefined): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

/** Any active, authenticated user (incl. AGENT) may CREATE/upload a resource —
 *  direct upload, no approval flow. requireUser() already rejects inactive /
 *  unauthenticated callers, so the mere presence of a role means "may create".
 *  Kept as an explicit helper so the gate reads intentionally at every call
 *  site (and so a future restriction has ONE place to change). */
export function canCreateResources(role: string | null | undefined): boolean {
  return !!role;
}

/** May this user EDIT/DELETE this specific resource?
 *  - ADMIN / MANAGER → yes, on ANY resource (manage all).
 *  - AGENT (or anyone else) → only their OWN uploads (uploadedById === userId).
 *  An unowned legacy resource (uploadedById === null) is admin/manager-only. */
export function canManageResource(
  role: string | null | undefined,
  uploadedById: string | null | undefined,
  userId: string | null | undefined,
): boolean {
  if (canManageResources(role)) return true;
  return !!userId && !!uploadedById && uploadedById === userId;
}

/** Human-readable size, e.g. "1.4 MB", "812 KB". */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A coarse icon key for the UI (file-type glyph) from a MIME type. */
export function fileKindIcon(mime: string | null | undefined): "image" | "pdf" | "file" {
  if (!mime) return "file";
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  return "file";
}

/** Public capability URL for a FILE resource — the cuid id is the unguessable
 *  capability, so recipients can open it without a CRM login. `origin` is the
 *  caller's origin (e.g. window.location.origin) so links work on prod/preview. */
export function publicFileUrl(origin: string, resourceId: string): string {
  return `${origin.replace(/\/$/, "")}/api/resources/${resourceId}/file`;
}

/** The shareable link for a resource: FILE → public download, URL → its fileUrl,
 *  TEXT → null (text is sent inline, not as a link). */
export function shareableLink(
  origin: string,
  r: { id: string; type: ResourceTypeStr; fileUrl?: string | null },
): string | null {
  if (r.type === "FILE") return publicFileUrl(origin, r.id);
  if (r.type === "URL") return r.fileUrl ?? null;
  return null;
}

/** Build the WhatsApp/Email message body for sharing a resource:
 *  title + the link (FILE/URL) or the template text (TEXT). */
export function buildShareMessage(
  origin: string,
  r: { id: string; title: string; type: ResourceTypeStr; fileUrl?: string | null; textContent?: string | null },
): string {
  if (r.type === "TEXT") return r.textContent?.trim() || r.title;
  const link = shareableLink(origin, r);
  return link ? `${r.title}\n${link}` : r.title;
}

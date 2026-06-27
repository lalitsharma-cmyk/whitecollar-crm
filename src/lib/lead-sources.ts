// ────────────────────────────────────────────────────────────────────────────
// src/lib/lead-sources.ts — the SINGLE source of truth for lead "Source".
//
// WHY THIS EXISTS
//   "Source" (lead provenance) and "Medium" (the communication channel) used to
//   be conflated. WhatsApp / Inbound Call / Email / Event are CHANNELS — they now
//   live in the Medium field, NOT Source. The New-Lead form was cleaned up to drop
//   those deprecated source enum values (task 11), but three OTHER source pickers
//   (Quick-Add FAB, lead-detail inline edit, Master-Data bulk edit) still offered
//   them — so picking one RE-created legacy `source = WHATSAPP/INBOUND_CALL` data
//   and tripped the `backfill-integrity` regression invariant (0 live leads may
//   carry those tokens). A lead "Sameer" had to be migrated off INBOUND_CALL by
//   hand on 2026-06-27; THIS module is the prevention fix so it can't recur.
//
//   To stop the drift for good, EVERY manual source picker imports ALLOWED_SOURCES
//   from here. There is now exactly ONE list. The `lead-source-pickers` regression
//   invariant source-scans the picker files to prove none re-introduce a
//   deprecated option.
//
//   Pure module — NO "server-only" import — so the client-component pickers AND the
//   read-only regression suite can both import it.
// ────────────────────────────────────────────────────────────────────────────

// Human labels for EVERY source token we may DISPLAY, including the deprecated
// ones. A historical lead whose `source` is still EVENT / EMAIL must resolve to a
// friendly label — this map is the lookup. (Deprecated tokens live here for
// DISPLAY only; they are deliberately ABSENT from ALLOWED_SOURCES so no PICKER can
// ever offer them.)
export const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: "Website",
  WCR_WEBSITE: "WCR Website",
  WCR_EVENT: "WCR Event",
  LANDING_PAGE: "Landing Page",
  REFERRAL: "Referral",
  FACEBOOK_ADS: "Facebook Ads",
  GOOGLE_ADS: "Google Ads",
  PORTAL_99ACRES: "Portal 99acres",
  PORTAL_MAGICBRICKS: "Portal MagicBricks",
  PORTAL_HOUSING: "Portal Housing",
  CSV_IMPORT: "CSV Import",
  OTHER: "Other",
  // ── Deprecated (DISPLAY-ONLY) — the channel now lives in Medium. NEVER add any
  //    of these to ALLOWED_SOURCES. ──
  WHATSAPP: "WhatsApp",
  INBOUND_CALL: "Inbound Call",
  EMAIL: "Email",
  EVENT: "Event",
};

// Source enum values that are DEPRECATED as a MANUAL choice — the channel moved to
// the Medium field. Pickers must never offer these; the `backfill-integrity`
// invariant keeps live `source` free of WHATSAPP/INBOUND_CALL, and the
// `lead-source-pickers` invariant keeps the picker CODE free of all four.
export const DEPRECATED_SOURCES = ["WHATSAPP", "INBOUND_CALL", "EMAIL", "EVENT"] as const;

// The ONLY source values shown in a MANUAL source picker (New-Lead form, Quick-Add
// FAB, lead-detail inline edit, Master-Data bulk edit). Order = display order.
// CSV_IMPORT is intentionally excluded — imports set it programmatically; it is
// never a manual choice. Anything not in this list is filtered out even if a
// caller passes the full Prisma enum.
export const ALLOWED_SOURCES = [
  "WEBSITE",
  "WCR_EVENT",
  "LANDING_PAGE",
  "REFERRAL",
  "FACEBOOK_ADS",
  "GOOGLE_ADS",
  "PORTAL_99ACRES",
  "PORTAL_MAGICBRICKS",
  "PORTAL_HOUSING",
  "OTHER",
] as const;

// Source FAMILIES — group the website/event enum variants so "is this a website
// lead?" / "is this an event lead?" is asked ONCE, canonically. Used by Master
// Data's section ordering + the "New Website Leads" / "Event Leads" presets, which
// previously string-matched a single display label ("Website" / "Event") and so
// silently MISSED WCR_WEBSITE / LANDING_PAGE / WCR_EVENT leads.
export const WEBSITE_SOURCES = ["WEBSITE", "WCR_WEBSITE", "LANDING_PAGE"] as const;
export const EVENT_SOURCES = ["WCR_EVENT", "EVENT"] as const;
export const isWebsiteSource = (s: string | null | undefined): boolean =>
  !!s && (WEBSITE_SOURCES as readonly string[]).includes(s);
export const isEventSource = (s: string | null | undefined): boolean =>
  !!s && (EVENT_SOURCES as readonly string[]).includes(s);

/**
 * Friendly label for any source token (deprecated tokens included so historical
 * display still resolves), else a humanised fallback ("FOO_BAR" → "Foo Bar").
 * Returns "" for null/empty so callers can use it directly in a `??` chain.
 */
export function sourceLabel(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return SOURCE_LABELS[v] || v.replaceAll("_", " ");
}

/**
 * `{ value, label }[]` for the allowed picker options, in display order.
 * Optionally intersect with the enum the server actually knows about so a
 * renamed/removed value can't 500 a form (mirrors the New-Lead form's guard).
 */
export function allowedSourceOptions(
  serverSources?: readonly string[],
): { value: string; label: string }[] {
  const known = serverSources ? new Set(serverSources) : null;
  return ALLOWED_SOURCES.filter((s) => !known || known.has(s)).map((value) => ({
    value,
    label: sourceLabel(value),
  }));
}

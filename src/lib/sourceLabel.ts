// Single source-of-truth for a lead's SOURCE as shown/filtered/reported across
// the CRM. The verbatim `sourceRaw` (exact sheet value: "Townscript",
// "Eventbrite", "WhatsApp Campaign June") is the truth; the legacy `source`
// enum is only a coarse fallback for leads imported before sourceRaw existed.
//
// Nothing user-facing should read the raw enum token directly — always go
// through effectiveSource() so analytics/filters/exports show the real value.

export const SOURCE_ENUM_LABELS: Record<string, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV Import",
  EVENT: "Event", REFERRAL: "Referral", INBOUND_CALL: "Inbound Call",
  FACEBOOK_ADS: "Facebook Ads", GOOGLE_ADS: "Google Ads",
  PORTAL_99ACRES: "99Acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing.com", OTHER: "Other",
};

/** Friendly label for a legacy LeadSource enum token. */
export function sourceEnumLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  return SOURCE_ENUM_LABELS[source] ?? source;
}

/**
 * The source value to DISPLAY / FILTER / REPORT on. Prefers verbatim sourceRaw;
 * falls back to the enum label ONLY for legacy leads with no sourceRaw yet.
 * Never returns a bare enum token like "CSV_IMPORT".
 */
export function effectiveSource(
  sourceRaw: string | null | undefined,
  source: string | null | undefined,
): string {
  const raw = (sourceRaw ?? "").trim();
  if (raw) return raw;
  return sourceEnumLabel(source);
}

/**
 * Group rows into a source breakdown keyed by the EFFECTIVE source. Replaces
 * Prisma `groupBy({ by: ["source"] })` (which exposes the corrupted enum) with a
 * fetch of `{ source, sourceRaw }` grouped in JS, so every chart/report shows the
 * real channel. Returns `{ source, n }[]` sorted by count desc.
 */
export function sourceBreakdown(
  rows: { source: string | null; sourceRaw: string | null }[],
): { source: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = effectiveSource(r.sourceRaw, r.source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);
}

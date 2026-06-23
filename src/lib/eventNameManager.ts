import { prisma } from "@/lib/prisma";

// Standard WCR event-listing platforms — always offered in the Event Name
// dropdown even before any lead has used them. Mirrors STANDARD_MEDIUMS.
export const STANDARD_EVENT_NAMES = ["Eventbrite", "Townscript", "BookMyShow", "AllEvents"] as const;

/**
 * All available event names: the standard platforms + any custom event names
 * already stored on leads (so a name typed once via "Other" reappears in the
 * dropdown for the next lead). "Other" is appended so the picker can offer the
 * free-text path. Pure-additive, read-only.
 */
export async function getAvailableEventNames(): Promise<string[]> {
  const rows = await prisma.lead.findMany({
    where: { eventName: { not: null }, deletedAt: null },
    select: { eventName: true },
    distinct: ["eventName"],
  });

  const standardLower = new Set(STANDARD_EVENT_NAMES.map((s) => s.toLowerCase()));
  const custom = new Set<string>();
  for (const r of rows) {
    const v = (r.eventName ?? "").trim();
    if (v && !standardLower.has(v.toLowerCase())) custom.add(v);
  }

  return [
    ...STANDARD_EVENT_NAMES,
    ...Array.from(custom).sort((a, b) => a.localeCompare(b)),
    "Other",
  ];
}

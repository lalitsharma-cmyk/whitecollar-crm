import { prisma } from "@/lib/prisma";

// Fixed standard mediums (not stored in DB, always available)
export const STANDARD_MEDIUMS = ["Call", "WhatsApp", "Email"] as const;
export type StandardMedium = (typeof STANDARD_MEDIUMS)[number];

/**
 * Get all available mediums: standard ones + any custom mediums from the database.
 */
export async function getAvailableMediums(): Promise<string[]> {
  // Get all unique custom mediums from leads
  const customMediums = await prisma.lead.findMany({
    where: {
      medium: "Other",
      mediumOther: { not: null },
    },
    select: { mediumOther: true },
    distinct: ["mediumOther"],
  });

  const customSet = new Set(
    customMediums.map((l) => l.mediumOther!).filter(Boolean)
  );

  return [
    ...STANDARD_MEDIUMS,
    ...Array.from(customSet).sort(),
    ...(customSet.size > 0 ? ["Other"] : []),
  ];
}

/**
 * Validate and prepare medium + custom value for saving.
 * Returns the correct medium and mediumOther values.
 */
export function validateMedium(
  medium: string | null | undefined,
  custom?: string | null | undefined
): { medium: string | null; mediumOther: string | null } {
  if (!medium) {
    return { medium: null, mediumOther: null };
  }

  // If "Other" is selected, require a custom value
  if (medium === "Other") {
    const trimmed = custom?.trim();
    if (!trimmed) {
      throw new Error("Custom medium name is required when selecting 'Other'");
    }
    return { medium: "Other", mediumOther: trimmed };
  }

  // Standard or pre-existing custom medium
  if (STANDARD_MEDIUMS.includes(medium as StandardMedium)) {
    return { medium, mediumOther: null };
  }

  // Could be a custom medium from the database
  return { medium, mediumOther: null };
}

/**
 * Get display label for a medium (handles both standard and custom).
 */
export function formatMedium(
  medium: string | null,
  mediumOther: string | null
): string {
  if (!medium) return "—";
  if (medium === "Other" && mediumOther) return mediumOther;
  return medium;
}

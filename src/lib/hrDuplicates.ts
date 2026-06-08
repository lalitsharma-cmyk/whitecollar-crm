import type { Prisma } from "@prisma/client";

/** Last 10 digits of a phone — lets +91 / 0-prefixed / spaced numbers match. */
export function last10(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Prisma `where` that finds candidates sharing a mobile, WhatsApp, or email
 * with the given inputs. Returns null when there's nothing to match on.
 * Used by both the create route (hard block) and the live check endpoint (warn).
 */
export function hrDuplicateWhere(
  phone?: string | null,
  whatsapp?: string | null,
  email?: string | null,
): Prisma.HRCandidateWhereInput | null {
  const phones = Array.from(
    new Set([last10(phone), last10(whatsapp)].filter(p => p.length >= 7)),
  );
  const e = (email ?? "").trim().toLowerCase();
  const OR: Prisma.HRCandidateWhereInput[] = [];
  for (const p of phones) {
    OR.push(
      { phone: { endsWith: p } },
      { whatsappPhone: { endsWith: p } },
      { altPhone: { endsWith: p } },
    );
  }
  if (e) OR.push({ email: { equals: e, mode: "insensitive" } });
  return OR.length ? { OR } : null;
}

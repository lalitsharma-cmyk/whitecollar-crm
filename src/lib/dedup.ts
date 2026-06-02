// dedup.ts — read-only duplicate-detection helper (B-01 dedup groundwork)
//
// PURPOSE: before a new lead is saved, call findPossibleDuplicates() to surface
// any existing leads whose phone or email matches. The result is presented to the
// user as an informational warning — NOT a block. The user can still submit.
//
// DESIGN DECISIONS:
//   • Read-only: no inserts, updates, or deletes.
//   • Returns at most 5 matches (take: 5) to keep the warning UI compact.
//   • Phone matching strategy:
//       - Primary: exact match on the normalised form against Lead.phone.
//         Historical rows may not be normalised (they were stored via toE164
//         before normalizePhone existed), so we ALSO match the raw submitted
//         value against the stored value.  This catches un-normalised historical
//         rows and correctly-normalised future rows.
//       - LIMITATION: if a historical row is stored as "9876543210" (no +91) and
//         the new entry is "+919876543210", this query will NOT detect the dup
//         because neither the raw nor the normalised form matches the stored raw.
//         Fix: a one-time backfill migration to normalise all phone columns.
//         Track as follow-up item (see dedup-followups in the project docs).
//   • Email matching: case-insensitive exact match (Prisma mode:"insensitive").
//   • Includes the lead's owner so the warning can display owner name.
//
// USAGE:
//   import { findPossibleDuplicates } from "@/lib/dedup";
//   const dupes = await findPossibleDuplicates({ phone: "+919876543210", email: "a@b.com" });

import "server-only";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { Prisma } from "@prisma/client";
import type { Lead, User } from "@prisma/client";

export type LeadWithOwner = Lead & { owner: User | null };

export interface DedupOpts {
  /** Raw or E.164 phone string from the form. May be null/undefined. */
  phone?: string | null;
  /** Email address from the form. May be null/undefined. */
  email?: string | null;
  /** Exclude this lead ID from results (used on edit forms to ignore self). */
  excludeId?: string;
  /**
   * Ownership scope fragment (from `leadScopeWhere(me)`) AND-ed into the query
   * so the dedup probe NEVER discloses a lead the caller can't already see.
   * Without it an AGENT entering a phone number would learn the name, owner
   * and pipeline status of a teammate's lead — exactly the cross-agent leak
   * class closed in audits B-02/B-03/B-13. ADMIN → {} (all), AGENT → own,
   * MANAGER → own + reports. Cross-agent duplicate visibility for agents is
   * deliberately deferred pending Lalit's policy sign-off.
   */
  scope?: Prisma.LeadWhereInput;
}

/**
 * Returns existing leads whose phone OR email likely matches the given values.
 *
 * Caps results at 5 (enough to show meaningful warnings without flooding the UI).
 * Returns an empty array when both phone and email are absent.
 */
export async function findPossibleDuplicates(opts: DedupOpts): Promise<LeadWithOwner[]> {
  const { phone, email, excludeId, scope } = opts;

  // Normalise the submitted phone so we can match it against stored E.164 values.
  // We also keep the raw form in case the stored value is un-normalised (legacy rows).
  const normPhone = phone ? normalizePhone(phone) : null;

  // Build the OR clauses for the Prisma query.
  // Each clause is only added when the relevant input is present.
  const orClauses: Prisma.LeadWhereInput[] = [];

  if (normPhone || phone) {
    // Match against: normalised form (future rows) OR the raw submitted value
    // (handles cases where the stored value equals what the agent typed).
    if (normPhone) {
      orClauses.push({ phone: normPhone });
      orClauses.push({ altPhone: normPhone });
    }
    const trimmedPhone = phone?.trim();
    if (trimmedPhone && trimmedPhone !== normPhone) {
      orClauses.push({ phone: trimmedPhone });
      orClauses.push({ altPhone: trimmedPhone });
    }
  }

  if (email && email.trim()) {
    orClauses.push({ email: { equals: email.trim(), mode: "insensitive" } });
  }

  if (orClauses.length === 0) return [];

  // AND together: (1) the caller's ownership scope so we never surface a lead
  // they can't see, (2) the phone/email OR match, (3) optional self-exclusion.
  const where: Prisma.LeadWhereInput = {
    AND: [
      scope ?? {},
      { OR: orClauses },
      ...(excludeId ? [{ id: { not: excludeId } }] : []),
    ],
  };

  const results = await prisma.lead.findMany({
    where,
    include: { owner: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return results;
}

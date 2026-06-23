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
//       - Canonical last-10-digits probe: in addition to the above, we run a
//         parameterised raw query that strips all non-digits from the stored
//         phone/altPhone and compares the RIGHTmost 10 digits to the submitted
//         number's last 10 digits. This catches the case where a historical row
//         is stored as "9876543210" (no +91) and the new entry is "+919876543210"
//         (and vice-versa) — neither the raw nor the normalised string matches,
//         but the last 10 digits do. The query reuses the EXACT REGEXP_REPLACE
//         expression from the admin duplicates page so the regex/escaping is
//         proven in prod Postgres; it is wrapped in try/catch so dev DBs without
//         REGEXP_REPLACE (e.g. SQLite) silently fall back to the clauses above.
//         The matched IDs are AND-ed under the same ownership scope (see below),
//         so this never widens what the caller can see.
//       - LIMITATION: the LIVE warning now matches on the last-10-digit canonical
//         form, so historical un-normalised rows ARE surfaced at warning time.
//         The stored-`fingerprint` dedupe applied at lead intake still relies on
//         normalised columns, so it continues to benefit from the one-time
//         backfill script that canonicalises all phone columns (separate
//         follow-up; see dedup-followups in the project docs).
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
  /** Alternative phone from the form (matched the same way as `phone`). */
  altPhone?: string | null;
  /** Alternative email from the form (matched the same way as `email`). */
  altEmail?: string | null;
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
  const { phone, email, altPhone, altEmail, excludeId, scope } = opts;

  // Build the OR clauses for the Prisma query.
  // Each clause is only added when the relevant input is present.
  const orClauses: Prisma.LeadWhereInput[] = [];

  // Phone matching is identical for the primary and alternative phone, and each
  // is matched against BOTH the stored phone AND altPhone columns. Process every
  // distinct phone value the form supplied.
  const phoneValues = [phone, altPhone]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p);
  const seenPhones = new Set<string>();
  for (const pv of phoneValues) {
    if (seenPhones.has(pv)) continue;
    seenPhones.add(pv);

    // Normalise so we can match against stored E.164 values; keep the raw form
    // too in case the stored value is un-normalised (legacy rows).
    const normPhone = normalizePhone(pv);
    if (normPhone) {
      orClauses.push({ phone: normPhone });
      orClauses.push({ altPhone: normPhone });
    }
    if (pv !== normPhone) {
      orClauses.push({ phone: pv });
      orClauses.push({ altPhone: pv });
    }

    // Canonical last-10-digits probe (additive, read-only). Strip every
    // non-digit and take the last 10 digits. Only proceed with a FULL 10-digit
    // canonical key — never match on shorter fragments (would over-match).
    const digits = pv.replace(/\D/g, "");
    const last10 = digits.slice(-10);
    if (last10.length === 10) {
      // Compare against the digit-only RIGHTmost-10 of stored phone/altPhone.
      // REGEXP_REPLACE expression copied verbatim from the admin duplicates page
      // so escaping is proven in prod Postgres. ${last10} is a Prisma bound
      // parameter — safe from injection. Wrapped in try/catch so dev DBs lacking
      // REGEXP_REPLACE (SQLite) just skip this enhancement.
      let idsFromDigits: string[] = [];
      try {
        const rows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Lead"
          WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g'), 10) = ${last10}
             OR RIGHT(REGEXP_REPLACE(COALESCE("altPhone", ''), '\D', '', 'g'), 10) = ${last10}
          LIMIT 50`;
        idsFromDigits = rows.map((r) => r.id);
      } catch {
        idsFromDigits = [];
      }
      if (idsFromDigits.length > 0) {
        // These IDs are still AND-ed under `scope` below, so we never reveal a
        // lead the caller couldn't already see.
        orClauses.push({ id: { in: idsFromDigits } });
      }
    }
  }

  // Email matching: case-insensitive exact match against the stored email, for
  // both the primary and alternative email values.
  const emailValues = [email, altEmail]
    .map((e) => e?.trim())
    .filter((e): e is string => !!e);
  const seenEmails = new Set<string>();
  for (const ev of emailValues) {
    const key = ev.toLowerCase();
    if (seenEmails.has(key)) continue;
    seenEmails.add(key);
    orClauses.push({ email: { equals: ev, mode: "insensitive" } });
  }

  if (orClauses.length === 0) return [];

  // AND together: (1) the caller's ownership scope so we never surface a lead
  // they can't see, (2) the phone/email OR match, (3) optional self-exclusion.
  const where: Prisma.LeadWhereInput = {
    AND: [
      scope ?? {},
      // deletedAt: null → a recycle-bin lead never raises a duplicate warning.
      { deletedAt: null },
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

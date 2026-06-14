// Investor-detection helper.
//
// Lalit's ask (2026-06-02):
// > "Any new lead entered should run a matching such as Name, email or number
// > anything matched? If yes, It should be tracked that He is a investor and
// > then his previous properties buyed, and all other details should be auto
// > fetched, so agent is able to have history."
//
// What this file does:
//   1. Given a freshly created lead, find OTHER Lead rows that probably
//      belong to the same human (priority: fingerprint > phone-tail > email >
//      name+city).
//   2. Summarise the matches to decide if the new lead is a returning
//      investor (≥1 historical WON or bookingDoneAt → investor).
//
// IMPORTANT: this helper is server-side ONLY. It returns RAW match data; the
// caller is responsible for scoping if surfacing to the UI (see
// /api/leads/[id]/investor-history which re-applies leadScopeWhere). When
// wiring from leadIngest.ts we DO surface bought-project history on the new
// lead itself — that data belongs to the same person, so the agent who owns
// the new lead has a legitimate need to see it.
//
// We deliberately DO NOT add a new schema table. Match is computed on the fly
// every time it's needed; the new lead just gets `categorization = "Investor"`
// + `alreadyBought` populated so subsequent renders are fast.

import { prisma } from "@/lib/prisma";
import { BOOKED_STATUSES } from "@/lib/lead-statuses";

export interface MatchedLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  currentStatus: string | null;
  alreadyBought: string | null;
  bookingDoneAt: Date | null;
  createdAt: Date;
}

/** Reason a lead matched — useful for debugging + audit-log traceability. */
export type MatchReason = "FINGERPRINT" | "PHONE_TAIL" | "EMAIL" | "NAME_CITY";

export interface MatchedLeadWithReason extends MatchedLead {
  matchReason: MatchReason;
}

export interface FindMatchingInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  /** When provided, exclude this lead id from results (skip the lead itself). */
  excludeLeadId?: string;
}

/** Last 10 digits — covers altPhone splits and "+91 vs 0091 vs bare" variants. */
function lastNDigits(p: string | null | undefined, n: number): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < n) return null;
  return d.slice(-n);
}

/**
 * Find leads that likely belong to the same person as `input`.
 *
 * Priority order (more reliable signals first):
 *   1. Same fingerprint (phone || email hash) — same identity as far as the
 *      ingest dedupe is concerned. Should already be caught by ingestLead;
 *      kept here as a safety net (and so the helper works standalone for
 *      future "merge leads" UI).
 *   2. Same last-10 phone digits — catches altPhone splits, missing country
 *      code, leading-zero variants.
 *   3. Same lowercased email.
 *   4. Same lowercased name AND same city — name alone is too noisy
 *      ("Rohit Sharma" in Delhi vs Mumbai are likely different people), but
 *      name + city is a reasonable third-tier signal for older imports that
 *      lost phone/email.
 *
 * Returns up to 20 matches (dedup'd by id, earliest priority wins). Caller is
 * responsible for any owner-scoping if surfacing across agents.
 */
export async function findMatchingLeads(input: FindMatchingInput): Promise<MatchedLeadWithReason[]> {
  const phoneTail = lastNDigits(input.phone, 10);
  const emailLc = input.email ? input.email.toLowerCase().trim() : null;
  const nameLc = input.name ? input.name.toLowerCase().trim() : null;
  const cityLc = input.city ? input.city.toLowerCase().trim() : null;

  // Nothing to match on — bail early.
  if (!phoneTail && !emailLc && !(nameLc && cityLc)) return [];

  // Aggregate matches in a Map<id, MatchedLeadWithReason> so each lead lands
  // exactly once tagged with its HIGHEST-priority reason.
  const acc = new Map<string, MatchedLeadWithReason>();

  const baseSelect = {
    id: true, name: true, phone: true, email: true, currentStatus: true,
    alreadyBought: true, bookingDoneAt: true, createdAt: true,
  } as const;

  // ── Priority 2: last-10 phone digits (covers fingerprint matches too,
  // since fingerprint is phone+email and the phone digit tail will hit). ──
  // Postgres-only query — REGEXP_REPLACE + RIGHT() match the prod datasource.
  // The exclude-id check is done in JS rather than SQL to keep the raw template
  // simple (Prisma's $queryRaw template tag doesn't compose well conditionally).
  if (phoneTail) {
    const rows = await prisma.$queryRaw<MatchedLead[]>`
      SELECT "id", "name", "phone", "email", "currentStatus",
             "alreadyBought", "bookingDoneAt", "createdAt"
      FROM "Lead"
      WHERE "phone" IS NOT NULL
        AND "deletedAt" IS NULL
        AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 10) = ${phoneTail}
      ORDER BY "createdAt" DESC
      LIMIT 20
    `;
    for (const r of rows) {
      if (input.excludeLeadId && r.id === input.excludeLeadId) continue;
      if (!acc.has(r.id)) acc.set(r.id, { ...r, matchReason: "PHONE_TAIL" });
    }
  }

  // ── Priority 3: same lowercased email. ──
  if (emailLc) {
    const rows = await prisma.lead.findMany({
      where: {
        email: emailLc,
        deletedAt: null,
        ...(input.excludeLeadId ? { id: { not: input.excludeLeadId } } : {}),
      },
      select: baseSelect,
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    for (const r of rows) {
      if (!acc.has(r.id)) acc.set(r.id, { ...r, matchReason: "EMAIL" });
    }
  }

  // ── Priority 4: same lowercased name AND city. ──
  // Weakest signal — only used when stronger ones miss. Case-insensitive
  // exact match (no fuzzy / Levenshtein — too expensive in the ingest path).
  if (nameLc && cityLc) {
    const rows = await prisma.lead.findMany({
      where: {
        name: { equals: nameLc, mode: "insensitive" },
        city: { equals: cityLc, mode: "insensitive" },
        deletedAt: null,
        ...(input.excludeLeadId ? { id: { not: input.excludeLeadId } } : {}),
      },
      select: baseSelect,
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    for (const r of rows) {
      if (!acc.has(r.id)) acc.set(r.id, { ...r, matchReason: "NAME_CITY" });
    }
  }

  // Sort by createdAt desc — most recent prior interactions first.
  return Array.from(acc.values()).sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export interface HistorySummary {
  /** True when ≥1 matched lead is "Booked with Us" or has bookingDoneAt set. */
  isInvestor: boolean;
  evidence: {
    /** Count of matches with "Booked with Us" status. */
    wonLeads: number;
    /** Count of matches with bookingDoneAt set (overlaps with wonLeads). */
    bookings: number;
    /** Deduped list of project names the matches indicate the client owns. */
    projectsBought: string[];
    /** When isInvestor=false, this is `matches.length`. */
    previousInquiries: number;
  };
}

/**
 * Inspect the matches and decide if this lead is a returning client.
 * - isInvestor=true when at least one match is WON or has bookingDoneAt set.
 * - projectsBought is the deduped union of `alreadyBought` strings from
 *   investor matches, lowercased + trimmed for dedup, original casing preserved.
 */
export function summariseHistory(matches: MatchedLead[]): HistorySummary {
  const wonLeads = matches.filter((m) => BOOKED_STATUSES.includes(m.currentStatus ?? "")).length;
  const bookings = matches.filter((m) => m.bookingDoneAt != null).length;

  // Pull `alreadyBought` from booked matches — those are the investor signals.
  const buyers = matches.filter((m) => BOOKED_STATUSES.includes(m.currentStatus ?? "") || m.bookingDoneAt != null);
  const seen = new Set<string>();
  const projectsBought: string[] = [];
  for (const m of buyers) {
    if (!m.alreadyBought) continue;
    for (const raw of m.alreadyBought.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      projectsBought.push(trimmed);
    }
  }

  const isInvestor = wonLeads > 0 || bookings > 0;
  return {
    isInvestor,
    evidence: {
      wonLeads,
      bookings,
      projectsBought,
      previousInquiries: matches.length,
    },
  };
}

/**
 * Convenience: pull project names from `interestedUnits` of matched leads
 * that were WON. Used by the ingest wiring to augment `alreadyBought` when
 * the historical leads didn't have it populated but DO have a booked unit.
 *
 * Returns deduped project names. Keep separate from `summariseHistory` so the
 * pure-data summariser stays synchronous.
 */
export async function projectsFromInterestedUnits(matchedLeadIds: string[]): Promise<string[]> {
  if (matchedLeadIds.length === 0) return [];
  const rows = await prisma.leadProperty.findMany({
    where: {
      leadId: { in: matchedLeadIds },
      lead: { OR: [{ currentStatus: { in: BOOKED_STATUSES } }, { bookingDoneAt: { not: null } }] },
    },
    select: { unit: { select: { project: { select: { name: true } } } } },
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const n = r.unit?.project?.name?.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

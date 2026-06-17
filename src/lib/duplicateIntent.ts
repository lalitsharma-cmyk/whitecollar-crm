import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── Duplicate-Intent Score ──────────────────────────────────────────────────
// Counts ONLY genuine inbound re-enquiries from the SAME customer (matched by
// mobile last-10 OR email, the same way customerHistory does) and surfaces the
// evidence behind the count.
//
// "Genuine inbound" means a real person reached out to us through a real inbound
// channel. We deliberately EXCLUDE bulk / system-generated rows so the score
// reflects true buying intent, not data plumbing:
//
//   ✅ COUNTS  — source is a genuine inbound channel:
//        WEBSITE, WHATSAPP, EVENT (expo), INBOUND_CALL, REFERRAL,
//        and manually-added rows (source OTHER created by hand).
//   ❌ IGNORED — source is a bulk import / migration:
//        CSV_IMPORT  (bulk import / migration)
//   ❌ IGNORED — paid-ad / portal lead-gen feeds (not a customer-initiated
//        re-enquiry to *us*):
//        FACEBOOK_ADS, GOOGLE_ADS,
//        PORTAL_99ACRES, PORTAL_MAGICBRICKS, PORTAL_HOUSING
//   ❌ IGNORED — record produced by a re-import / restore / rollback / migration
//        / revival, regardless of source:
//        - any row carrying an importBatchId (created by a bulk import batch)
//        - any soft-deleted (deletedAt) row that was later restored/rolled back
//        - leadOrigin of MASTER_DATA / PORTFOLIO / SYSTEM / REVIVAL / COLD
//          (repository / system / revival rows are not a fresh inbound enquiry)
//
// The result is deterministic — no Math.random, ordering is by createdAt desc.

function last10(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

// Sources that represent a genuine customer-initiated inbound enquiry.
const GENUINE_INBOUND_SOURCES: ReadonlySet<string> = new Set([
  "WEBSITE",
  "WHATSAPP",
  "EVENT",
  "INBOUND_CALL",
  "REFERRAL",
  "OTHER", // manually-added rows default to OTHER
]);

// leadOrigin values that mean "not a fresh inbound enquiry" — repository,
// system-generated, or revival/cold rows. (Legacy origins kept for the
// transition: ACTIVE/ACTIVE_LEAD are the only ones that stay eligible.)
const NON_INBOUND_ORIGINS: ReadonlySet<string> = new Set([
  "MASTER_DATA",
  "PORTFOLIO",
  "SYSTEM",
  "REVIVAL",
  "COLD",
]);

export interface DuplicateIntentEvidence {
  source: string;   // LeadSource value, e.g. "WEBSITE"
  date: string;     // ISO timestamp of the enquiry (createdAt)
  section: string;  // human label of where it lives, e.g. "Leads"
}

export interface DuplicateIntent {
  score: number;        // = genuineCount (number of genuine inbound enquiries)
  genuineCount: number; // number of GENUINE inbound enquiries from this customer
  evidence: DuplicateIntentEvidence[]; // one row per genuine enquiry, newest first
}

// Mirror of customerHistory's section mapping, for display in the evidence list.
function sectionOf(leadOrigin: string | null, deletedAt: Date | null): string {
  if (deletedAt) return "Closed/Archived";
  if (leadOrigin === "REVIVAL" || leadOrigin === "COLD") return "Revival";
  if (leadOrigin === "MASTER_DATA" || leadOrigin === "PORTFOLIO" || leadOrigin === "SYSTEM") return "Master Data";
  return "Leads";
}

// A single lead row is a genuine inbound enquiry only if EVERY check passes.
function isGenuineInbound(l: {
  source: string;
  leadOrigin: string | null;
  importBatchId: string | null;
  deletedAt: Date | null;
}): boolean {
  // Came from a bulk import batch (re-import / migration / restore) → not genuine.
  if (l.importBatchId) return false;
  // Soft-deleted / rolled-back rows are not a live inbound enquiry.
  if (l.deletedAt) return false;
  // Repository / system / revival origins are not a fresh inbound enquiry.
  if (l.leadOrigin && NON_INBOUND_ORIGINS.has(l.leadOrigin)) return false;
  // Source must be a real inbound channel.
  if (!GENUINE_INBOUND_SOURCES.has(l.source)) return false;
  return true;
}

/**
 * Duplicate-Intent Score for a customer.
 *
 * Matches the customer by phone (last-10, on phone OR altPhone) and/or email
 * (case-insensitive), exactly like getCustomerHistory. Counts only GENUINE
 * inbound enquiries (see rules above).
 *
 * @returns null when there is no genuine repeat intent (nothing to match on, or
 *          fewer than 1 genuine enquiry). Otherwise { score, genuineCount,
 *          evidence } where score === genuineCount and evidence is newest-first.
 *
 * Note: excludeId is NOT subtracted from the count — the current lead, if it is
 * itself a genuine inbound enquiry, is part of the customer's genuine-intent
 * tally. It is accepted for parity with getCustomerHistory and reserved use.
 */
export async function getDuplicateIntent(
  phone?: string | null,
  email?: string | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  excludeId?: string,
  // Optional confidentiality scope (leadScopeWhere). When passed it already
  // includes deletedAt:null plus the owner/team restriction, so an Agent/Manager
  // never counts other agents'/teams' enquiries toward this customer's intent.
  // Omitted → deletedAt:null-only default, unchanged for admin/unscoped callers.
  scope?: Prisma.LeadWhereInput,
): Promise<DuplicateIntent | null> {
  const p = last10(phone);
  const e = (email ?? "").trim().toLowerCase();

  const OR: Array<Record<string, unknown>> = [];
  if (p.length >= 7) OR.push({ phone: { endsWith: p } }, { altPhone: { endsWith: p } });
  if (e) OR.push({ email: { equals: e, mode: "insensitive" } });
  if (OR.length === 0) return null;

  const leads = await prisma.lead.findMany({
    // deletedAt: null → recycle-bin records never count toward duplicate intent.
    // A supplied confidentiality `scope` replaces the deletedAt:null default and
    // also adds the owner/team restriction; otherwise keep deletedAt:null only.
    where: { AND: [scope ?? { deletedAt: null }, { OR }] },
    select: {
      createdAt: true,
      source: true,
      leadOrigin: true,
      importBatchId: true,
      deletedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const genuine = leads.filter(isGenuineInbound);
  if (genuine.length === 0) return null;

  const evidence: DuplicateIntentEvidence[] = genuine.map((l) => ({
    source: l.source,
    date: l.createdAt.toISOString(),
    section: sectionOf(l.leadOrigin, l.deletedAt),
  }));

  return {
    score: genuine.length,
    genuineCount: genuine.length,
    evidence,
  };
}

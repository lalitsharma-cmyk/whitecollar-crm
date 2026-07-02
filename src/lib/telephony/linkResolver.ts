import "server-only";
// Cross-module call linking. Given a phone number, find the ONE CRM record the
// call belongs to so the recording + outcome land in the right timeline:
//   • Lead        — regular lead (matched by fingerprint)
//   • Revival     — cold/revival lead (also a Lead row; isColdCall / revival origin)
//   • Buyer       — BuyerRecord (Dubai OR India), matched inside its phones JSON
//
// Precedence: an ACTIVE Lead wins over a Buyer (a working lead is the live sales
// context). Soft-deleted records are never matched. Returns nulls when nothing
// matches → the call is stored UNLINKED (Unmatched Calls Queue) and never lost.
import { prisma } from "@/lib/prisma";
import { fingerprintFor } from "@/lib/assignment";
import { normalizePhone } from "./normalize";

export interface CallLink {
  leadId: string | null;
  isRevival: boolean;      // the matched lead is a cold/revival lead
  buyerId: string | null;
  buyerMarket: string | null; // "Dubai" | "India" when a buyer matched
}

const EMPTY: CallLink = { leadId: null, isRevival: false, buyerId: null, buyerMarket: null };

/** Digit substrings to probe buyer.phones with (format-agnostic trailing match). */
function digitCandidates(normalized: string): string[] {
  const digits = normalized.replace(/\D/g, "");
  const out = new Set<string>();
  if (digits.length >= 10) out.add(digits.slice(-10));
  if (digits.length >= 7) out.add(digits.slice(-9));
  out.add(digits);
  return [...out].filter((c) => c.length >= 7);
}

/** Resolve a raw phone to its owning CRM record. `explicit` from a click-to-call
 *  customIdentifier ("lead:<id>" | "buyer:<id>") short-circuits the lookup. */
export async function resolveCallLink(rawPhone: string | null, explicit?: string | null): Promise<CallLink> {
  // 1) Trust an explicit identifier we set ourselves on the outbound dial.
  if (explicit) {
    const m = /^(lead|buyer):(.+)$/.exec(explicit.trim());
    if (m) {
      const [, kind, id] = m;
      if (kind === "lead") {
        const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true, isColdCall: true, leadOrigin: true } });
        if (lead) return { leadId: lead.id, isRevival: isRevivalLead(lead), buyerId: null, buyerMarket: null };
      } else {
        const buyer = await prisma.buyerRecord.findFirst({ where: { id, deletedAt: null }, select: { id: true, market: true } });
        if (buyer) return { leadId: null, isRevival: false, buyerId: buyer.id, buyerMarket: buyer.market };
      }
    }
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) return EMPTY;

  // 2) Active Lead by fingerprint (covers regular AND revival/cold leads).
  const fp = fingerprintFor(phone, undefined);
  if (fp) {
    const lead = await prisma.lead.findFirst({
      where: { fingerprint: fp, deletedAt: null },
      select: { id: true, isColdCall: true, leadOrigin: true },
      orderBy: { lastTouchedAt: "desc" },
    });
    if (lead) return { leadId: lead.id, isRevival: isRevivalLead(lead), buyerId: null, buyerMarket: null };
  }

  // 3) BuyerRecord whose phones JSON contains this number (Dubai or India).
  for (const cand of digitCandidates(phone)) {
    const buyer = await prisma.buyerRecord.findFirst({
      where: { deletedAt: null, phones: { contains: cand } },
      select: { id: true, market: true },
      orderBy: { updatedAt: "desc" },
    });
    if (buyer) return { leadId: null, isRevival: false, buyerId: buyer.id, buyerMarket: buyer.market };
  }

  return EMPTY;
}

const REVIVAL_ORIGINS = new Set(["COLD_CALL", "REVIVAL", "COLD", "COLD_DATA", "REVIVAL_ENGINE"]);
function isRevivalLead(l: { isColdCall: boolean | null; leadOrigin: string | null }): boolean {
  return l.isColdCall === true || (l.leadOrigin != null && REVIVAL_ORIGINS.has(l.leadOrigin));
}

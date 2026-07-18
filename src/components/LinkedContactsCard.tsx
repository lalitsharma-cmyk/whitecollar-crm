// Server component that surfaces "Linked contacts" on the lead detail page.
//
// Three sections, any of which can be empty:
//   1. Alt contact on file — uses lead.altName / lead.altPhone (already on the
//      Lead row, captured when MIS sheets have "Soumya, Ayush Gupta" + two
//      phone numbers in one cell).
//   2. Other leads with same / similar number — searches other Lead rows whose
//      phone shares the last 8 digits with THIS lead's phone OR altPhone. The
//      shared-tail heuristic catches the same person re-submitting with a
//      different country prefix (e.g. +91… vs 0091… vs bare 10-digit) and
//      family members on the same handset.
//   3. Decision-maker hint — when BANT = QUALIFIES and an altName is on file,
//      nudge the agent to loop the alt contact into the next WhatsApp (often
//      the spouse / parent who actually signs).
//
// Hides the entire card when there's nothing to show (no altPhone AND no
// related leads) so it doesn't add visual noise on solo, untagged leads.

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { telLink, whatsappLink } from "@/lib/phone";
// This is a SERVER component, so the alt-contact Call uses the DialLink client
// island to fire the dial beacon (a server component cannot attach an onClick).
import DialLink from "@/components/DialLink";

interface Props {
  leadId: string;
  leadName: string;
  phone: string | null;
  altPhone: string | null;
  altName: string | null;
  bantStatus?: string | null;
}

// Postgres-only: $queryRaw uses RIGHT(REGEXP_REPLACE(...)) — matches the prod
// datasource (datasource.provider = "postgresql" in schema.prisma).
type RelatedLeadRow = {
  id: string;
  name: string;
  status: string;
  phone: string | null;
};

function last8Digits(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-8);
}

export default async function LinkedContactsCard({
  leadId,
  leadName,
  phone,
  altPhone,
  altName,
  bantStatus,
}: Props) {
  // Build the set of last-8 digit tails to search against.
  const tails = Array.from(
    new Set([last8Digits(phone), last8Digits(altPhone)].filter((x): x is string => !!x))
  );

  let relatedLeads: RelatedLeadRow[] = [];
  if (tails.length > 0) {
    // Build the IN(...) clause inline. Tails are 8-char digit-only strings — we
    // validated that above with replace(/\D/g, "") — safe to inline as a
    // single-quoted Postgres string list, but we still go through $queryRawUnsafe
    // with explicit params to keep Prisma's parameterisation.
    if (tails.length === 1) {
      relatedLeads = await prisma.$queryRaw<RelatedLeadRow[]>`
        SELECT "id", "name", "status", "phone"
        FROM "Lead"
        WHERE "id" <> ${leadId}
          AND "phone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 8) = ${tails[0]}
        ORDER BY "updatedAt" DESC
        LIMIT 3
      `;
    } else {
      // tails.length === 2 — both phone and altPhone contributed a tail.
      relatedLeads = await prisma.$queryRaw<RelatedLeadRow[]>`
        SELECT "id", "name", "status", "phone"
        FROM "Lead"
        WHERE "id" <> ${leadId}
          AND "phone" IS NOT NULL
          AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 8) IN (${tails[0]}, ${tails[1]})
        ORDER BY "updatedAt" DESC
        LIMIT 3
      `;
    }
  }

  const hasAlt = !!(altPhone && altPhone.trim().length > 0);
  const hasRelated = relatedLeads.length > 0;
  const showDecisionMakerHint = bantStatus === "QUALIFIES" && !!(altName && altName.trim().length > 0);

  // Hide the whole card if there's nothing to show.
  if (!hasAlt && !hasRelated && !showDecisionMakerHint) return null;

  const waGreetingAlt =
    altName
      ? `Hi ${altName}, this is from White Collar Realty. We've been in touch with ${leadName} regarding a property — happy to share details with you too.`
      : `Hi, this is from White Collar Realty. We've been in touch with ${leadName} regarding a property — happy to share details with you too.`;

  return (
    <div className="card p-5">
      <div className="font-semibold mb-3">🔗 Linked contacts</div>

      {/* Section 1 — Alt contact on file */}
      {hasAlt && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
            Alt contact on file
          </div>
          <div className="text-sm">
            {altName ? <b>{altName}</b> : <span className="text-gray-500">Unnamed</span>}
            <span className="text-gray-500"> · {altPhone}</span>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <DialLink
              href={telLink(altPhone)}
              leadId={leadId}
              phone={altPhone}
              className="btn btn-sm border border-gray-300 text-xs px-2 py-1 rounded"
            >
              📞 Call
            </DialLink>
            <a
              href={whatsappLink(altPhone, waGreetingAlt)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm border border-emerald-300 bg-emerald-50 text-emerald-800 text-xs px-2 py-1 rounded"
            >
              💬 WhatsApp
            </a>
          </div>
        </div>
      )}

      {/* Section 2 — Other leads with same / similar number */}
      {hasRelated && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-1">
            Other leads with same / similar number
          </div>
          <div className="text-[11px] text-gray-500 mb-2">
            Could be spouse, parent, sibling — same handset / household.
          </div>
          <div className="space-y-1.5">
            {relatedLeads.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 border border-[#e5e7eb] rounded-lg px-2 py-1.5"
              >
                <Link
                  href={`/leads/${r.id}`}
                  className="text-sm text-[#0b1a33] font-semibold truncate hover:underline"
                >
                  {r.name}
                </Link>
                <span className="chip chip-warm text-[10px] flex-shrink-0">
                  {r.status.replaceAll("_", " ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section 3 — Decision-maker hint */}
      {showDecisionMakerHint && (
        <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
          💡 Decision maker likely: <b>{altName}</b>. Loop them into the next WhatsApp.
        </div>
      )}
    </div>
  );
}

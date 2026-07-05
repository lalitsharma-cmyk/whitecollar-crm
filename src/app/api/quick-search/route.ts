// GLOBAL SEARCH — the header search box + Ctrl/Cmd+K palette.
//
// ONE endpoint that searches EVERY lead-based module and returns module-labelled
// customer cards:
//   • Leads / Master Data / Revival Engine  — all live in the Lead table, split by
//     leadOrigin (+ isColdCall) into the right module label.
//   • Dubai Buyer Data / India Buyer Data    — the BuyerRecord table, split by market.
//
// SEARCHES (partial, case-insensitive, extra spaces ignored): name, mobile, alternate
// number, email, company, and project name (where applicable).
//
// ROLE SCOPE is server-enforced and NON-NEGOTIABLE:
//   • Leads  → leadScopeWhere(me)  — an AGENT only ever matches leads they own.
//   • Buyers → buyerSearchScope(me) — an AGENT only ever matches their own ASSIGNED
//     buyers (any market); a MANAGER their org sub-tree; ADMIN all. No cross-agent,
//     no cross-market, no pool leak to an agent.
// Every query is capped via `take:` — never an unbounded scan. Trigram GIN indexes
// (migration below) keep the `contains` matches fast at 100k+ rows.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere, COLD_ORIGINS, MASTER_DATA_ORIGINS } from "@/lib/leadScope";
import { buyerSearchScope } from "@/lib/buyerScope";
import { projectWhereForUser } from "@/lib/propertyScope";

// Search begins at 3 characters (matches the client trigger + keeps scans bounded).
const MIN_CHARS = 3;
const LEAD_TAKE = 12;
const BUYER_TAKE = 12;

function leadModuleLabel(origin: string | null, isColdCall: boolean): string {
  if ((origin && COLD_ORIGINS.includes(origin)) || isColdCall) return "Revival Engine";
  if (origin && MASTER_DATA_ORIGINS.includes(origin)) return "Master Data";
  return "Leads";
}

/** First phone out of a BuyerRecord.phones JSON array (["+9715…", …]). */
function firstPhone(phonesJson: string | null): string | null {
  if (!phonesJson) return null;
  try {
    const arr = JSON.parse(phonesJson);
    return Array.isArray(arr) && arr.length ? String(arr[0]) : null;
  } catch {
    return phonesJson;
  }
}

export interface SearchHit {
  recordType: "lead" | "buyer";
  module: string;
  id: string;
  name: string;
  phone: string | null;
  agent: string;
  status: string;
  href: string;
}

export async function GET(req: NextRequest) {
  const me = await requireUser();
  // Case-insensitive + ignore extra spaces: collapse runs of whitespace, trim ends.
  const q = (req.nextUrl.searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < MIN_CHARS) return NextResponse.json({ results: [], projects: [] });

  const leadScope = await leadScopeWhere(me);
  const buyerScope = await buyerSearchScope(me);

  const [leads, buyers, projects] = await Promise.all([
    prisma.lead.findMany({
      where: {
        ...leadScope,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { altPhone: { contains: q } },
          { email: { contains: q, mode: "insensitive" } },
          { company: { contains: q, mode: "insensitive" } },
          // Project name (where applicable) — via the lead's interested projects.
          { interestedProjects: { some: { project: { name: { contains: q, mode: "insensitive" } } } } },
        ],
      },
      take: LEAD_TAKE,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, name: true, phone: true, currentStatus: true, leadOrigin: true, isColdCall: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.buyerRecord.findMany({
      where: {
        ...buyerScope,
        OR: [
          { clientName: { contains: q, mode: "insensitive" } },
          { phones: { contains: q } },                       // JSON array of all numbers (incl. alternates)
          { emails: { contains: q, mode: "insensitive" } },  // JSON array of emails
          { projectName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: BUYER_TAKE,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, clientName: true, phones: true, businessStatus: true, poolStatus: true, market: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.project.findMany({
      where: {
        ...projectWhereForUser(me),
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { city: { contains: q, mode: "insensitive" } },
        ],
      },
      take: 5,
      select: { id: true, name: true, city: true, country: true },
    }),
  ]);

  const results: SearchHit[] = [
    ...leads.map((l) => ({
      recordType: "lead" as const,
      module: leadModuleLabel(l.leadOrigin, l.isColdCall),
      id: l.id,
      name: l.name,
      phone: l.phone,
      agent: l.owner?.name ?? "Unassigned",
      status: l.currentStatus?.trim() || "New",
      href: `/leads/${l.id}`,
    })),
    ...buyers.map((b) => ({
      recordType: "buyer" as const,
      module: b.market === "India" ? "India Buyer Data" : "Dubai Buyer Data",
      id: b.id,
      name: b.clientName,
      phone: firstPhone(b.phones),
      agent: b.owner?.name ?? "Admin Pool",
      status: b.businessStatus?.trim() || b.poolStatus || "—",
      href: b.market === "India" ? `/india-buyer-data/${b.id}` : `/buyer-data/${b.id}`,
    })),
  ];

  return NextResponse.json({ results, projects });
}

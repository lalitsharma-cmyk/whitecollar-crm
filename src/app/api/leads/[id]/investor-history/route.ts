// GET /api/leads/[id]/investor-history
//
// Returns the resolved matched-lead history (full names, status, dates) for
// the InvestorBanner dropdown. Re-applies leadScopeWhere(me) so a manager who
// shouldn't see a particular prior lead gets it filtered out — we don't leak
// other agents' clients through the history surface.
//
// Lazy-loaded by the banner on first click; SSR ships only counts and IDs.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead, leadScopeWhere } from "@/lib/leadScope";
import { findMatchingLeads } from "@/lib/investorMatch";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const me = await requireUser();

  // Authoritative gate on the LEAD itself — caller must be able to touch it.
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, ownerId: true, name: true, phone: true, email: true, city: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canTouchLead(me, lead))) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Run the matcher. Returns *all* candidates; we then filter by ownership
  // scope so a manager/agent never sees a match that belongs to an out-of-scope
  // owner.
  const matches = await findMatchingLeads({
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    city: lead.city,
    excludeLeadId: lead.id,
  });

  if (matches.length === 0) return NextResponse.json({ matches: [] });

  // Re-fetch with the owner-scope filter to ensure no out-of-scope rows slip
  // through. We could intersect IDs in memory, but going through Prisma keeps
  // the scoping logic in one place (leadScopeWhere) and is cheap with the
  // (small) ID list.
  const scope = await leadScopeWhere(me);
  const scopedRows = await prisma.lead.findMany({
    where: { id: { in: matches.map((m) => m.id) }, ...scope },
    select: {
      id: true,
      name: true,
      status: true,
      bookingDoneAt: true,
      createdAt: true,
      alreadyBought: true,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return NextResponse.json({ matches: scopedRows });
}

// GET /api/leads/[id]/intelligence
//
// Returns the stored IntelligenceMatch for a lead, shaped into the
// IntelligenceResult contract consumed by CustomerIntelligenceCard.
//
// Delegates to getIntelligenceResult() from intelligenceCheck.ts which
// already fetches previousLeads and portfolioEntries from the DB.
//
// Auth: same canTouchLead check as the lead detail page.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { getIntelligenceResult } from "@/lib/intelligenceCheck";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const me = await requireUser();

  // Verify agent can touch this lead
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, ownerId: true },
  });
  if (!lead) return NextResponse.json({ match: null }, { status: 404 });
  if (!(await canTouchLead(me, lead))) {
    return NextResponse.json({ match: null }, { status: 403 });
  }

  const result = await getIntelligenceResult(id);

  if (!result || result.matchType === "NONE") {
    return NextResponse.json({ match: null });
  }

  // Serialize Date fields for JSON transport
  const match = {
    matchType: result.matchType,
    confidence: result.confidence,
    matchedBy: result.matchedBy,
    history: result.history,
    previousAgentName: result.previousAgentName,
    previousStatus: result.previousStatus,
    lastContactAt: result.lastContactAt ? result.lastContactAt.toISOString() : null,
    totalRecordsFound: result.totalRecordsFound,
    totalPropertiesFound: result.totalPropertiesFound,
    projectMatch: result.projectMatch,
    projectNote: result.projectNote,
    aiSummary: result.aiSummary,
    suggestedApproach: result.suggestedApproach,
    previousLeads: result.previousLeads.map((l) => ({
      id: l.id,
      name: l.name,
      status: l.status,
      createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
      agentName: l.agentName,
      remarks: l.remarks,
    })),
    portfolioEntries: result.portfolioEntries.map((p) => ({
      project: p.project,
      unit: p.unit,
      tower: p.tower,
      transactionValueAed: p.transactionValueAed,
      date: p.date instanceof Date ? p.date.toISOString() : p.date,
    })),
  };

  return NextResponse.json({ match });
}

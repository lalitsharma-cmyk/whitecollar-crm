// GET /api/ai/matches?propertyLeadId=... — READ-ONLY buyer↔seller matches for a
// seller's property lead. Ranked + explainable (M2/M3). Never mutates. Scope-safe
// (canTouchLead) + gated behind ai.enabled (default OFF).
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { getSetting } from "@/lib/settings";
import { findBuyerMatchesForProperty } from "@/lib/ai/matchingService";

export async function GET(req: NextRequest) {
  const me = await requireUser();
  if ((await getSetting("ai.enabled")).toLowerCase() !== "true") {
    return NextResponse.json({ error: "AI is disabled" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("propertyLeadId");
  if (!id) return NextResponse.json({ error: "propertyLeadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  if (!lead || !(await canTouchLead(me, lead))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const matches = await findBuyerMatchesForProperty(id, 20);
  return NextResponse.json({ ok: true, count: matches.length, matches });
}

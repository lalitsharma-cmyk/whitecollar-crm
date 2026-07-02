// GET /api/ai/memory?leadId=... — READ-ONLY compacted memory for one lead (recent
// calls/notes/status + prior AI decisions). Scope-safe (canTouchLead) + gated behind
// ai.enabled (default OFF). Never mutates.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { getSetting } from "@/lib/settings";
import { buildLeadMemory } from "@/lib/ai/memoryService";

export async function GET(req: NextRequest) {
  const me = await requireUser();
  if ((await getSetting("ai.enabled")).toLowerCase() !== "true") {
    return NextResponse.json({ error: "AI is disabled" }, { status: 403 });
  }
  const id = req.nextUrl.searchParams.get("leadId");
  if (!id) return NextResponse.json({ error: "leadId is required" }, { status: 400 });

  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  if (!lead || !(await canTouchLead(me, lead))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const memory = await buildLeadMemory(id);
  return NextResponse.json({ ok: true, ...memory });
}

// GET /api/ai/analyze?kind=lead&id=... — READ-ONLY AI analysis (M1).
// Returns the Brain's signals/detections/suggestions for one entity. Never mutates
// (applying a suggestion is a separate, approval-gated route — M2+). Scope-safe: an
// agent may only analyze a lead they can access (canTouchLead). Gated behind the
// global ai.enabled flag (default OFF) so it's inert until enabled.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { getSetting } from "@/lib/settings";
import { analyzeEntity } from "@/lib/ai/brain";
import type { AiEntityKind } from "@/lib/ai/types";

const KINDS: AiEntityKind[] = ["lead", "buyer", "cold", "customer"];

export async function GET(req: NextRequest) {
  const me = await requireUser();

  // Global AI kill-switch: default OFF. Read-only, but stays gated until turned on.
  const enabled = (await getSetting("ai.enabled")).toLowerCase() === "true";
  if (!enabled) return NextResponse.json({ error: "AI is disabled" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const kind = (sp.get("kind") ?? "lead") as AiEntityKind;
  const id = sp.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!KINDS.includes(kind)) return NextResponse.json({ error: "invalid kind" }, { status: 400 });

  // Scope guard: only analyze a lead the caller may see (404, never confirm existence).
  if (kind === "lead") {
    const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, ownerId: true } });
    if (!lead || !(await canTouchLead(me, lead))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const result = await analyzeEntity(kind, id);
  if (!result) return NextResponse.json({ error: "Not found or unsupported kind" }, { status: 404 });
  return NextResponse.json({ ok: true, result });
}

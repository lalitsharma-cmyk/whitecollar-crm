// GET /api/ai/data-quality — ADMIN-only, gated behind ai.enabled (default OFF).
// READ-ONLY self-heal scan: returns reversible market-fix SUGGESTIONS for leads whose
// market is empty but derivable. Each suggestion carries a mutation that can be applied
// (after review) via POST /api/ai/apply. Never mutates.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { scanMarketFixes } from "@/lib/ai/dataQualityService";

export async function GET(req: NextRequest) {
  await requireRole("ADMIN");
  if ((await getSetting("ai.enabled")).toLowerCase() !== "true") {
    return NextResponse.json({ error: "AI is disabled" }, { status: 403 });
  }
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 100;

  const suggestions = await scanMarketFixes(limit);
  return NextResponse.json({ ok: true, count: suggestions.length, suggestions });
}

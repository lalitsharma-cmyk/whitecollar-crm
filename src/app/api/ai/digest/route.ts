// GET /api/ai/digest — ADMIN-only, gated behind ai.enabled (default OFF). READ-ONLY
// Coach/Analyst/BI daily digest: pipeline-health summary + per-agent coaching nudges +
// top risks. Optional ?market=India|UAE. Never mutates.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { buildTeamDigest } from "@/lib/ai/analyticsService";

export async function GET(req: NextRequest) {
  await requireRole("ADMIN");
  if ((await getSetting("ai.enabled")).toLowerCase() !== "true") {
    return NextResponse.json({ error: "AI is disabled" }, { status: 403 });
  }
  const mParam = req.nextUrl.searchParams.get("market");
  const market = mParam === "India" || mParam === "UAE" ? mParam : undefined;

  const digest = await buildTeamDigest({ market });
  return NextResponse.json({ ok: true, ...digest });
}

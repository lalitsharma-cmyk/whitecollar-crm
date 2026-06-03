/**
 * GET  /api/ai/trial          → list all runs (newest first) with summary stats
 * POST /api/ai/trial/create   → this route is at /api/ai/trial/create/route.ts
 *
 * This file handles GET /api/ai/trial.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listRuns } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireRole("ADMIN", "MANAGER");
  const runs = await listRuns();
  return NextResponse.json({ runs });
}

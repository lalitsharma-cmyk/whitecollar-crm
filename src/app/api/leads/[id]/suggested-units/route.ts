import { NextResponse, type NextRequest } from "next/server";
import { loadOwnedLead } from "@/lib/leadScope";
import { bestUnitsForLead } from "@/lib/inventoryMatch";

// GET /api/leads/[id]/suggested-units?limit=3
// Returns top-N AVAILABLE units that best fit the lead's budget + configuration + team.
// Scoping reuses loadOwnedLead so agents can't probe leads they don't own.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const parsed = limitRaw ? Number(limitRaw) : 3;
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 10) : 3;

  const units = await bestUnitsForLead(id, limit);
  return NextResponse.json({ units });
}

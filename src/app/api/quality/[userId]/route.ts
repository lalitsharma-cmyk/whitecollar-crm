// GET /api/quality/[userId]?window=today|week|month
//
// Returns the QualityBreakdown for the requested user. Ownership rules:
//   • ADMIN  — can read anyone
//   • MANAGER — can read self + direct reports; wellbeing axis omitted for reports
//   • AGENT   — can read self only
//
// Used by the QualityScoreCard client component (window-selector chips fire
// a re-fetch with a different ?window=).

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  canViewQualityFor,
  computeQualityScore,
  type QualityWindow,
} from "@/lib/qualityScore";

export const dynamic = "force-dynamic";

const VALID_WINDOWS = new Set<QualityWindow>(["today", "week", "month"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const me = await requireUser();
  const { userId } = await params;

  const url = new URL(req.url);
  const wRaw = (url.searchParams.get("window") ?? "week").toLowerCase();
  if (!VALID_WINDOWS.has(wRaw as QualityWindow)) {
    return NextResponse.json({ error: "Invalid window" }, { status: 400 });
  }
  const window = wRaw as QualityWindow;

  const allowed = await canViewQualityFor(
    { id: me.id, role: me.role as "ADMIN" | "MANAGER" | "AGENT" },
    userId,
  );
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Manager viewing a report's score must NOT see the wellbeing breakdown
  // (privacy line per spec §4). Admin and the agent themselves see it.
  const isSelf = me.id === userId;
  const excludeWellbeing = !isSelf && me.role === "MANAGER";

  const breakdown = await computeQualityScore(userId, window, { excludeWellbeing });
  return NextResponse.json({ ...breakdown, window });
}

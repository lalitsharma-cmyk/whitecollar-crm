/**
 * GET /api/ai/trial/[id]/report
 *
 * Response: { report: RunReport }
 *
 * Returns the run plus summary stats:
 * processed, failed, skipped, inputTokens, outputTokens, costMicroUsd,
 * estCostMicroUsd, avgCostPerLead, avgMs, model, features, createdAt, finishedAt.
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { getRunReport } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  try {
    const report = await getRunReport(id);
    return NextResponse.json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

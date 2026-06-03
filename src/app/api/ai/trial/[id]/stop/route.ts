/**
 * POST /api/ai/trial/[id]/stop
 *
 * Response: { run: AiTrialRun }
 *
 * Stops a RUNNING or PAUSED trial run (→ STOPPED).
 * Remaining pending items are marked as "skipped".
 * Results so far are kept for review. NOT auto-resumed.
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { stopRun } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  try {
    const run = await stopRun(id);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

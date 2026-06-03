/**
 * POST /api/ai/trial/[id]/pause
 *
 * Response: { run: AiTrialRun }
 *
 * Pauses a RUNNING trial run (RUNNING → PAUSED).
 * Completed items are kept; pending items remain pending and can be resumed
 * by calling POST /api/ai/trial/[id]/confirm again (PAUSED → RUNNING).
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { pauseRun } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  try {
    const run = await pauseRun(id);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

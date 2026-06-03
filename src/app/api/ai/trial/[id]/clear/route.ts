/**
 * POST /api/ai/trial/[id]/clear
 *
 * Response: { run: AiTrialRun }
 *
 * Deletes all AiTrialItem rows for this run, resets run counters to 0,
 * and transitions the run back to DRAFT so it can be re-run.
 * NEVER touches Lead data.
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { clearRunOutputs } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  try {
    const run = await clearRunOutputs(id);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

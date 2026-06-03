/**
 * POST /api/ai/trial/[id]/confirm
 *
 * Response: { run: AiTrialRun }
 *
 * Transitions run DRAFT → RUNNING. Admin confirms the cost estimate and
 * authorises the trial to begin. Must be called before stepRun.
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { confirmRun } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  try {
    const run = await confirmRun(id);
    return NextResponse.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

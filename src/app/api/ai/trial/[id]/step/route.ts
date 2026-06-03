/**
 * POST /api/ai/trial/[id]/step
 *
 * Body: { batchSize?: number }   (default 5)
 * Response: { processed: number, failed: number, done: boolean, run: AiTrialRun }
 *
 * Processes the next batch of pending items in a RUNNING trial run.
 * Client-driven: call repeatedly until done=true (or pause/stop).
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { stepRun } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const batchSize = body.batchSize ? Math.min(Math.max(Number(body.batchSize), 1), 20) : 5;

  try {
    const result = await stepRun(id, batchSize);
    return NextResponse.json({
      processed: result.processed,
      failed: result.failed,
      done: result.done,
      run: result.run,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

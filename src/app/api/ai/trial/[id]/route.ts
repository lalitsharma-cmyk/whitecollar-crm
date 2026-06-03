/**
 * PATCH /api/ai/trial/[id]
 *
 * Body: { qualityNote?: string }
 * Response: { ok: true }
 *
 * Updates mutable metadata on a trial run (currently: quality notes).
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;

  const body = await req.json().catch(() => ({}));

  const update: { qualityNote?: string } = {};
  if (typeof body.qualityNote === "string") {
    update.qualityNote = body.qualityNote;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const run = await prisma.aiTrialRun.findUnique({ where: { id } });
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await prisma.aiTrialRun.update({ where: { id }, data: update });
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/ai/trial/create
 *
 * Body: { sampleSize: number, team?: string, source?: string, features: string[] }
 * Response: { run: AiTrialRun }
 *
 * Creates a DRAFT trial run with cost estimate and sampled leads.
 * Admin only.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createRun } from "@/lib/aiTrial";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");

  const body = await req.json().catch(() => ({}));
  const sampleSize = Number(body.sampleSize);
  const team = body.team ? String(body.team).trim() || null : null;
  const source = body.source ? String(body.source).trim() || null : null;
  const features: string[] = Array.isArray(body.features)
    ? body.features.map((f: unknown) => String(f)).filter(Boolean)
    : [];

  if (!sampleSize || sampleSize < 1 || sampleSize > 500) {
    return NextResponse.json(
      { error: "sampleSize must be between 1 and 500" },
      { status: 400 },
    );
  }
  if (features.length === 0) {
    return NextResponse.json(
      { error: "At least one feature is required" },
      { status: 400 },
    );
  }

  const validFeatures = ["summary", "score", "nextAction", "waDraft", "coldRevival", "propertyMatch"];
  const invalidFeatures = features.filter(f => !validFeatures.includes(f));
  if (invalidFeatures.length > 0) {
    return NextResponse.json(
      { error: `Unknown features: ${invalidFeatures.join(", ")}. Valid: ${validFeatures.join(", ")}` },
      { status: 400 },
    );
  }

  const run = await createRun({
    sampleSize,
    team,
    source,
    features,
    createdById: me.id,
  });

  return NextResponse.json({ run }, { status: 201 });
}

// POST /api/leads/[id]/ai-extract
//
// Runs the AI extraction pipeline on a lead's full conversation history.
// Stores results in AiExtraction, auto-applies high-confidence fields if the
// "ai.extraction.autoApply" setting is ON, and always creates LeadProject
// suggestion rows for any projects the AI identifies.
//
// Gated by ai.enabled (admin kill-switch). Returns 402 when AI is disabled.

import { NextResponse, type NextRequest } from "next/server";
import { loadOwnedLead } from "@/lib/leadScope";
import { runAIExtraction, getLatestExtraction } from "@/lib/aiExtractor";
import { getAiEnabled } from "@/lib/settings";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const aiOn = await getAiEnabled();
  if (!aiOn) {
    return NextResponse.json(
      { error: "AI is disabled. Enable it in Settings → AI Intelligence." },
      { status: 402 },
    );
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const triggeredBy = String(body.triggeredBy ?? "manual") as import("@/lib/aiExtractor").ExtractionTrigger;

  const result = await runAIExtraction(id, triggeredBy, { leadId: id });

  if (!result) {
    return NextResponse.json(
      { error: "AI extraction failed or returned no result. Check the lead has text history." },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, result });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  const latest = await getLatestExtraction(id);
  if (!latest) return NextResponse.json({ result: null });

  return NextResponse.json({ result: latest.result, createdAt: latest.createdAt });
}

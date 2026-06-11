import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeLeadWithAI, openAiEnabled, isAiPilotLead } from "@/lib/ai-openai";
import { NextResponse } from "next/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await requireUser();
  const { id } = await params;

  if (!openAiEnabled()) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured. Add it in Vercel → Settings → Environment Variables." }, { status: 503 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id, deletedAt: null },
    include: {
      owner: { select: { name: true } },
      discussed: { include: { project: { select: { name: true, city: true } } }, orderBy: { discussedAt: "desc" } },
      activities: { orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
      callLogs: { orderBy: { startedAt: "desc" }, take: 50, include: { user: { select: { name: true } } } },
      notes: { orderBy: { createdAt: "desc" }, take: 30, include: { user: { select: { name: true } } } },
    },
  });

  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Pilot scope: only Lalit's leads
  if (!isAiPilotLead(lead.ownerId)) {
    return NextResponse.json({ error: "AI Copilot pilot is currently only available for Lalit Sharma's leads." }, { status: 403 });
  }

  // Agents can only analyze their own leads; admins/managers can analyze any
  if (me.role === "AGENT" && lead.ownerId !== me.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { reanalyze?: boolean };
  const triggeredBy = body.reanalyze ? "re-analyze" : "manual";

  try {
    const { analysisId, result } = await analyzeLeadWithAI(lead as Parameters<typeof analyzeLeadWithAI>[0], me.id, triggeredBy);
    return NextResponse.json({ analysisId, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI analysis failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// GET — return the latest analysis for this lead (no AI call)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireUser();
  const { id } = await params;

  const analysis = await prisma.aiAnalysis.findFirst({
    where: { leadId: id },
    orderBy: { createdAt: "desc" },
    include: { feedbacks: { orderBy: { createdAt: "desc" } } },
  });

  if (!analysis) return NextResponse.json({ analysis: null });

  return NextResponse.json({
    analysis: {
      id: analysis.id,
      createdAt: analysis.createdAt,
      model: analysis.model,
      inputTokens: analysis.inputTokens,
      outputTokens: analysis.outputTokens,
      costMicroUsd: analysis.costMicroUsd,
      ok: analysis.ok,
      error: analysis.error,
      result: analysis.ok ? JSON.parse(analysis.resultJson) : null,
      feedbacks: analysis.feedbacks,
    },
  });
}

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzeLeadWithGpt, gptIntelligenceEnabled, isAiPilotLead, getLatestGptIntelligence } from "@/lib/ai-gpt-intelligence";
import { NextResponse } from "next/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  if (!gptIntelligenceEnabled()) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured." }, { status: 503 });
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
  if (!isAiPilotLead(lead.ownerId)) {
    return NextResponse.json({ error: "GPT Intelligence pilot is only available for Lalit Sharma's leads." }, { status: 403 });
  }
  if (me.role === "AGENT" && lead.ownerId !== me.id) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as { reanalyze?: boolean };

  try {
    const { analysisId, result } = await analyzeLeadWithGpt(
      lead as Parameters<typeof analyzeLeadWithGpt>[0],
      me.id,
      body.reanalyze ? "re-analyze" : "manual"
    );
    return NextResponse.json({ analysisId, result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "GPT analysis failed" }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const analysis = await getLatestGptIntelligence(id);
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
    },
  });
}

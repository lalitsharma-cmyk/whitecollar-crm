import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { generateConversationSummary, aiEnabled, aiProvider } from "@/lib/ai";

/**
 * POST /api/leads/[id]/regenerate-summary
 *
 * Manually trigger the AI Summary + Next Action regeneration for one lead.
 * Same code path as the auto-refresh on every CallLog create — but synchronous
 * so the caller knows whether it worked (vs the fire-and-forget on log-call
 * which silently dies on Vercel function teardown).
 *
 * Surfaced as a "🔄 Regenerate" button on the Client Summary card so Lalit
 * can fix the "AI does not update" case without having to log a fake call.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  if (!aiEnabled()) {
    return NextResponse.json({
      ok: false,
      reason: "No AI key configured. Hit /api/ai/health for diagnostics.",
    }, { status: 503 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id },
    include: { callLogs: { orderBy: { startedAt: "desc" }, take: 10 } },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const t0 = Date.now();
  const result = await generateConversationSummary(
    {
      name: lead.name,
      company: lead.company,
      city: lead.city,
      configuration: lead.configuration,
      budgetMin: lead.budgetMin,
      budgetCurrency: lead.budgetCurrency,
      whoIsClient: lead.whoIsClient,
      categorization: lead.categorization,
      fundReadiness: lead.fundReadiness,
      whenCanInvest: lead.whenCanInvest,
      status: lead.status,
      remarks: lead.remarks,
    },
    lead.callLogs.map((c) => ({
      startedAt: c.startedAt,
      outcome: c.outcome,
      durationSec: c.durationSec,
      notes: c.notes,
      attributedAgentName: c.attributedAgentName,
    })),
  );
  const ms = Date.now() - t0;

  if (!result) {
    return NextResponse.json({
      ok: false,
      provider: aiProvider(),
      reason: "AI returned no usable response. Could be wrong key, exhausted quota, or empty model output. Check /api/ai/health.",
      latencyMs: ms,
    }, { status: 502 });
  }

  await prisma.lead.update({
    where: { id },
    data: {
      aiSummary: result.summary || lead.aiSummary,
      aiNextAction: result.nextAction || lead.aiNextAction,
      aiUpdatedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    provider: aiProvider(),
    summary: result.summary,
    nextAction: result.nextAction,
    latencyMs: ms,
  });
}

// Manual "🧠 Deep AI analysis" trigger.
//
// Calls Anthropic with the FULL lead context (every qualification field,
// the raw remarks, the last 30 call logs with outcomes + notes, the last
// 30 activities) and overwrites Lead.aiScore + aiScoreValue + aiSummary +
// aiNextAction + aiUpdatedAt.
//
// Costs roughly $0.01-0.05 per click (Claude Haiku or Sonnet depending on
// CLAUDE_MODEL env var). Auth: lead must be owned by the caller (or caller
// is admin/manager). Activity row is logged so admin sees who burned tokens.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { scoreLead } from "@/lib/ai";
import { ActivityType, ActivityStatus, AIScore } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  // Pull the full lead + recent context
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      callLogs: { orderBy: { startedAt: "desc" }, take: 30 },
      activities: { orderBy: { createdAt: "desc" }, take: 30 },
      interestedUnits: { include: { unit: { include: { project: true } } }, take: 3 },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Build a rich AI input that includes the FULL remarks + recent call notes.
  // We summarise the call/activity history into a compact bullet timeline so
  // the model has the situation context without us burning a huge prompt.
  const recentCalls = lead.callLogs.slice(0, 15).map((c) => {
    const dt = c.startedAt.toISOString().slice(0, 10);
    return `  • ${dt} — ${c.outcome.replaceAll("_", " ")}${c.notes ? `: ${c.notes.slice(0, 200)}` : ""}`;
  }).join("\n");
  const recentActs = lead.activities.slice(0, 10).map((a) => {
    return `  • ${a.createdAt.toISOString().slice(0, 10)} — ${a.type.replaceAll("_", " ")}: ${a.title}`;
  }).join("\n");

  const enrichedRemarks = [
    lead.remarks ?? "",
    recentCalls ? `\n\n[Recent call history]\n${recentCalls}` : "",
    recentActs ? `\n\n[Recent activities]\n${recentActs}` : "",
  ].filter(Boolean).join("");

  const daysOld = Math.max(0, Math.floor((Date.now() - lead.createdAt.getTime()) / (24 * 3600 * 1000)));
  const lastTouchDaysAgo = lead.lastTouchedAt
    ? Math.max(0, Math.floor((Date.now() - lead.lastTouchedAt.getTime()) / (24 * 3600 * 1000)))
    : null;
  const callsConnected = lead.callLogs.filter((c) => c.outcome === "CONNECTED" || c.outcome === "INTERESTED").length;
  const interestedProject = lead.interestedUnits[0]?.unit.project.name ?? null;

  const result = await scoreLead({
    name: lead.name,
    source: lead.source,
    status: lead.status,
    currentStatus: lead.currentStatus,
    city: lead.city, country: lead.country, company: lead.company,
    configuration: lead.configuration,
    budgetMin: lead.budgetMin, budgetMax: lead.budgetMax,
    budgetCurrency: lead.budgetCurrency,
    whoIsClient: lead.whoIsClient,
    potential: lead.potential, fundReadiness: lead.fundReadiness,
    whenCanInvest: lead.whenCanInvest, moodStatus: lead.moodStatus,
    categorization: lead.categorization,
    remarks: enrichedRemarks,  // ← full remarks + call/activity timeline
    todoNext: lead.todoNext,
    tags: lead.tags,
    daysOld,
    activityCount: lead.activities.length,
    callsConnected,
    lastTouchDaysAgo,
    interestedProject,
  });

  await prisma.lead.update({
    where: { id },
    data: {
      aiScore: result.bucket as AIScore,
      aiScoreValue: result.score,
      aiSummary: result.summary,
      aiNextAction: result.nextAction,
      aiUpdatedAt: new Date(),
    },
  });

  // Log on timeline so admin sees this was a manual re-analysis
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: `🧠 Deep AI analysis (${result.bucket} · ${result.score}/100)`,
      description: result.summary,
      completedAt: new Date(),
    },
  });
  await audit({
    userId: me.id, action: "lead.deep-analyze", entity: "Lead", entityId: id,
    meta: { score: result.score, bucket: result.bucket }, request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, score: result.score, bucket: result.bucket, summary: result.summary });
}

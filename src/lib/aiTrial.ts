import "server-only";
import { prisma } from "@/lib/prisma";
import {
  generateTextWithUsage,
  costMicroUsd,
  activeModel,
  aiProvider,
  AI_PRICES,
  type GenContext,
  type LeadForAI,
  scoreLead,
  generateConversationSummary,
  type CallForAI,
} from "@/lib/ai";
import type { AiTrialRun, AiTrialItem } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Feature token estimates (rough — conservative for cost estimation).
// Values are "typical" input/output token counts per feature per lead.
// ─────────────────────────────────────────────────────────────────────────────
const FEATURE_TOKENS: Record<string, { input: number; output: number }> = {
  summary:       { input: 800, output: 300 },
  score:         { input: 500, output: 200 },
  nextAction:    { input: 600, output: 250 },
  waDraft:       { input: 700, output: 400 },
  coldRevival:   { input: 600, output: 250 },
  propertyMatch: { input: 500, output: 200 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface EstimateCostResult {
  estCostMicroUsd: number;
  inputTokensEst: number;
  outputTokensEst: number;
  pricePerMTokenIn: number;
  pricePerMTokenOut: number;
}

export interface StepResult {
  processed: number;
  failed: number;
  done: boolean;
}

export interface RunReport {
  id: string;
  status: string;
  sampleSize: number;
  team: string | null;
  source: string | null;
  features: string[];
  provider: string | null;
  model: string | null;
  totalLeads: number;
  processed: number;
  failed: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  estCostMicroUsd: number | null;
  avgCostPerLead: number;
  avgMs: number;
  createdById: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  qualityNote: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// a) estimateCost
// ─────────────────────────────────────────────────────────────────────────────
export function estimateCost(
  sampleSize: number,
  features: string[],
  modelId?: string,
): EstimateCostResult {
  const model = modelId ?? activeModel() ?? "gemini-1.5-flash";

  const DEFAULT_PRICE = { inPerM: 1.0, outPerM: 5.0 };
  const price = AI_PRICES[model] ?? DEFAULT_PRICE;

  let totalInput = 0;
  let totalOutput = 0;
  for (const feature of features) {
    const tokens = FEATURE_TOKENS[feature] ?? { input: 600, output: 250 };
    totalInput += tokens.input * sampleSize;
    totalOutput += tokens.output * sampleSize;
  }

  const estCostMicroUsd = costMicroUsd(model, totalInput, totalOutput);

  return {
    estCostMicroUsd,
    inputTokensEst: totalInput,
    outputTokensEst: totalOutput,
    pricePerMTokenIn: price.inPerM,
    pricePerMTokenOut: price.outPerM,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// b) createRun
// ─────────────────────────────────────────────────────────────────────────────
export async function createRun(params: {
  sampleSize: number;
  team?: string | null;
  source?: string | null;
  features: string[];
  createdById: string;
}): Promise<AiTrialRun> {
  const { sampleSize, team, source, features, createdById } = params;
  const model = activeModel();
  const provider = aiProvider();

  // Sample lead IDs deterministically (createdAt ASC, LIMIT sampleSize)
  const whereClause: Record<string, unknown> = {};
  if (team) whereClause.forwardedTeam = team;
  if (source) whereClause.source = source;

  const leads = await prisma.lead.findMany({
    where: whereClause,
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: sampleSize,
  });

  const actualSampleSize = leads.length;
  const { estCostMicroUsd } = estimateCost(actualSampleSize, features, model ?? undefined);

  // Create run + items in a transaction
  const run = await prisma.$transaction(async (tx) => {
    const newRun = await tx.aiTrialRun.create({
      data: {
        status: "DRAFT",
        sampleSize,
        team: team ?? null,
        source: source ?? null,
        features: features.join(","),
        provider: provider ?? null,
        model: model ?? null,
        totalLeads: actualSampleSize,
        estCostMicroUsd,
        createdById,
      },
    });

    // Create one AiTrialItem per (lead × feature)
    const itemData = [];
    for (const lead of leads) {
      for (const feature of features) {
        itemData.push({
          runId: newRun.id,
          leadId: lead.id,
          feature,
          status: "pending",
        });
      }
    }

    if (itemData.length > 0) {
      await tx.aiTrialItem.createMany({ data: itemData });
    }

    return newRun;
  });

  return run;
}

// ─────────────────────────────────────────────────────────────────────────────
// c) confirmRun
// ─────────────────────────────────────────────────────────────────────────────
export async function confirmRun(runId: string): Promise<AiTrialRun> {
  const run = await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });
  // Accepts DRAFT (first confirm) or PAUSED (resume)
  if (run.status !== "DRAFT" && run.status !== "PAUSED") {
    throw new Error(`Run ${runId} is ${run.status}, expected DRAFT or PAUSED`);
  }
  const now = new Date();
  return prisma.aiTrialRun.update({
    where: { id: runId },
    data: {
      status: "RUNNING",
      confirmedAt: run.confirmedAt ?? now, // preserve original confirm time on resume
      startedAt: run.startedAt ?? now,     // preserve original start time on resume
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead fetch helper — minimal fields for AI functions
// ─────────────────────────────────────────────────────────────────────────────
async function fetchLeadForTrial(leadId: string) {
  return prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      name: true,
      phone: true,
      source: true,
      status: true,
      currentStatus: true,
      city: true,
      country: true,
      company: true,
      configuration: true,
      budgetMin: true,
      budgetMax: true,
      budgetCurrency: true,
      whoIsClient: true,
      potential: true,
      fundReadiness: true,
      whenCanInvest: true,
      moodStatus: true,
      categorization: true,
      remarks: true,
      todoNext: true,
      tags: true,
      aiScore: true,
      notesShort: true,
      lastTouchedAt: true,
      forwardedTeam: true,
      createdAt: true,
      callLogs: {
        select: {
          startedAt: true,
          outcome: true,
          durationSec: true,
          notes: true,
          attributedAgentName: true,
        },
        orderBy: { startedAt: "desc" },
        take: 10,
      },
      activities: {
        select: { createdAt: true },
        where: { status: "DONE" },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Process a single (item × feature) — returns result to be written
// ─────────────────────────────────────────────────────────────────────────────
async function processItem(
  item: AiTrialItem,
  run: AiTrialRun,
): Promise<{ inputTokens: number; outputTokens: number; costMicroUsd: number; ms: number; output: string | null; error: string | null; status: string }> {
  const ctx: GenContext = {
    feature: item.feature,
    leadId: item.leadId,
    trialRunId: run.id,
    trial: true,
    log: true,
  };

  const lead = await fetchLeadForTrial(item.leadId);
  if (!lead) {
    return { inputTokens: 0, outputTokens: 0, costMicroUsd: 0, ms: 0, output: null, error: "Lead not found", status: "error" };
  }

  const t0 = Date.now();

  try {
    if (item.feature === "score") {
      // Use the existing scoreLead function, but we need to pass ctx
      // scoreLead() calls generateText() internally which doesn't expose GenResult.
      // Instead, call generateTextWithUsage directly with the scoring prompt.
      const activityCount = lead.activities?.length ?? 0;
      const callsConnected = lead.callLogs?.filter(c => c.outcome === "CONNECTED").length ?? 0;
      const lastTouchDaysAgo = lead.lastTouchedAt
        ? Math.floor((Date.now() - lead.lastTouchedAt.getTime()) / 86400000)
        : null;
      const daysOld = Math.floor((Date.now() - lead.createdAt.getTime()) / 86400000);

      // Build LeadForAI shape for scoreLead
      const leadForAI: LeadForAI = {
        name: lead.name,
        source: lead.source,
        status: lead.status,
        currentStatus: lead.currentStatus,
        city: lead.city,
        country: lead.country,
        company: lead.company,
        configuration: lead.configuration,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        budgetCurrency: lead.budgetCurrency,
        whoIsClient: lead.whoIsClient,
        potential: lead.potential,
        fundReadiness: lead.fundReadiness,
        whenCanInvest: lead.whenCanInvest,
        moodStatus: lead.moodStatus,
        categorization: lead.categorization,
        remarks: lead.remarks,
        todoNext: lead.todoNext,
        tags: lead.tags,
        daysOld,
        activityCount,
        callsConnected,
        lastTouchDaysAgo,
      };

      const result = await scoreLead(leadForAI, ctx);
      const ms = Date.now() - t0;

      // scoreLead uses generateText internally which doesn't return token counts.
      // We read the latest AiUsageLog for this trialRunId+leadId+feature to get tokens.
      const lastLog = await prisma.aiUsageLog.findFirst({
        where: { trialRunId: run.id, leadId: lead.id, feature: "score" },
        orderBy: { createdAt: "desc" },
      });

      return {
        inputTokens: lastLog?.inputTokens ?? 0,
        outputTokens: lastLog?.outputTokens ?? 0,
        costMicroUsd: lastLog?.costMicroUsd ?? 0,
        ms,
        output: JSON.stringify(result),
        error: null,
        status: "done",
      };
    }

    if (item.feature === "summary") {
      const callLogs: CallForAI[] = lead.callLogs.map(c => ({
        startedAt: c.startedAt,
        outcome: c.outcome,
        durationSec: c.durationSec,
        notes: c.notes,
        attributedAgentName: c.attributedAgentName,
      }));

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
        callLogs,
        ctx,
      );
      const ms = Date.now() - t0;

      const lastLog = await prisma.aiUsageLog.findFirst({
        where: { trialRunId: run.id, leadId: lead.id, feature: "summary" },
        orderBy: { createdAt: "desc" },
      });

      return {
        inputTokens: lastLog?.inputTokens ?? 0,
        outputTokens: lastLog?.outputTokens ?? 0,
        costMicroUsd: lastLog?.costMicroUsd ?? 0,
        ms,
        output: result ? JSON.stringify(result) : null,
        error: result ? null : "AI disabled or no output",
        status: result ? "done" : "skipped",
      };
    }

    // For features without dedicated functions: use generateTextWithUsage directly.
    let prompt = "";
    let maxTokens = 300;

    if (item.feature === "nextAction") {
      maxTokens = 250;
      prompt = `You are a Dubai real-estate sales coach. Based on this lead, suggest a specific next action.

Lead: ${lead.name}${lead.company ? ` · ${lead.company}` : ""}
Stage: ${lead.status} · Current status: ${lead.currentStatus ?? "—"}
Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"} - ${lead.budgetMax ?? "?"}
Fund readiness: ${lead.fundReadiness ?? "?"} · Timeline: ${lead.whenCanInvest ?? "?"}
Potential: ${lead.potential ?? "?"} · Mood: ${lead.moodStatus ?? "?"}
Last touch: ${lead.lastTouchedAt ? `${Math.floor((Date.now() - lead.lastTouchedAt.getTime()) / 86400000)}d ago` : "never"}
Who is client: ${lead.whoIsClient ?? "(not captured)"}
Remarks: ${(lead.remarks ?? "").slice(0, 500)}

Reply with ONLY a single specific next-action sentence (no preamble, no JSON).`;
    } else if (item.feature === "waDraft") {
      maxTokens = 400;
      prompt = `You are a Dubai property sales agent. Write a short, friendly WhatsApp follow-up message for this lead.

Lead: ${lead.name}
Looking for: ${lead.configuration ?? "property"} · Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"}
Stage: ${lead.status} · Mood: ${lead.moodStatus ?? "?"}
Who is client: ${lead.whoIsClient ?? "(not captured)"}

Write a natural 2-3 sentence WhatsApp message. No hashtags. No placeholders like [Agent Name]. Sign off as the White Collar Realty team.`;
    } else if (item.feature === "coldRevival") {
      maxTokens = 250;
      prompt = `You are a senior real-estate sales manager. This lead has gone cold. Write a brief revival strategy.

Lead: ${lead.name}${lead.company ? ` · ${lead.company}` : ""}
Last status: ${lead.currentStatus ?? lead.status}
Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"} - ${lead.budgetMax ?? "?"}
Who is client: ${lead.whoIsClient ?? "(not captured)"}
Remarks: ${(lead.remarks ?? "").slice(0, 400)}

Reply with ONE specific revival tactic (2-3 sentences max).`;
    } else if (item.feature === "propertyMatch") {
      maxTokens = 200;
      prompt = `You are a Dubai property expert. Based on this buyer profile, suggest what type of property would best match their needs.

Lead: ${lead.name}
Budget: ${lead.budgetCurrency ?? "AED"} ${lead.budgetMin ?? "?"} - ${lead.budgetMax ?? "?"}
Looking for: ${lead.configuration ?? "?"}
Who is client: ${lead.whoIsClient ?? "(not captured)"}
Potential: ${lead.potential ?? "?"} · Fund readiness: ${lead.fundReadiness ?? "?"}

Reply with 1-2 sentences describing the ideal property match for this buyer.`;
    } else {
      // Unknown feature — skip gracefully
      return {
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        ms: 0,
        output: null,
        error: `Unknown feature: ${item.feature}`,
        status: "skipped",
      };
    }

    const result = await generateTextWithUsage({ prompt, maxTokens }, ctx);
    const ms = Date.now() - t0;

    if (result.state === "disabled") {
      return {
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        ms,
        output: null,
        error: "AI not enabled",
        status: "skipped",
      };
    }

    if (result.state === "no_provider") {
      return {
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        ms,
        output: null,
        error: "No AI provider configured",
        status: "skipped",
      };
    }

    if (result.state === "error" || result.text === null) {
      return {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicroUsd: costMicroUsd(result.model, result.inputTokens, result.outputTokens),
        ms,
        output: null,
        error: "AI generation failed",
        status: "error",
      };
    }

    return {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costMicroUsd: costMicroUsd(result.model, result.inputTokens, result.outputTokens),
      ms,
      output: result.text,
      error: null,
      status: "done",
    };
  } catch (err) {
    const ms = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    return {
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      ms,
      output: null,
      error: message.slice(0, 500),
      status: "error",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// d) stepRun
// ─────────────────────────────────────────────────────────────────────────────
export async function stepRun(
  runId: string,
  batchSize = 5,
): Promise<StepResult & { run: AiTrialRun }> {
  const run = await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "RUNNING") {
    throw new Error(`Run ${runId} is ${run.status}, expected RUNNING`);
  }

  // Fetch next N pending items
  const items = await prisma.aiTrialItem.findMany({
    where: { runId, status: "pending" },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  let batchProcessed = 0;
  let batchFailed = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;
  let batchCost = 0;
  let batchMs = 0;

  for (const item of items) {
    const result = await processItem(item, run);

    // Write item result
    await prisma.aiTrialItem.update({
      where: { id: item.id },
      data: {
        status: result.status,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costMicroUsd: result.costMicroUsd,
        ms: result.ms,
        output: result.output,
        error: result.error,
      },
    });

    batchInputTokens += result.inputTokens;
    batchOutputTokens += result.outputTokens;
    batchCost += result.costMicroUsd;
    batchMs += result.ms;

    if (result.status === "done") batchProcessed++;
    else if (result.status === "error") batchFailed++;
    // "skipped" counts as neither processed nor failed
  }

  // Check if all items are now done/error/skipped
  const remaining = await prisma.aiTrialItem.count({
    where: { runId, status: "pending" },
  });
  const done = remaining === 0;

  const updatedRun = await prisma.aiTrialRun.update({
    where: { id: runId },
    data: {
      processed: { increment: batchProcessed },
      failed: { increment: batchFailed },
      inputTokens: { increment: batchInputTokens },
      outputTokens: { increment: batchOutputTokens },
      costMicroUsd: { increment: batchCost },
      totalMs: { increment: batchMs },
      ...(done ? { status: "DONE", finishedAt: new Date() } : {}),
    },
  });

  return { processed: batchProcessed, failed: batchFailed, done, run: updatedRun };
}

// ─────────────────────────────────────────────────────────────────────────────
// e) pauseRun
// ─────────────────────────────────────────────────────────────────────────────
export async function pauseRun(runId: string): Promise<AiTrialRun> {
  const run = await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "RUNNING") {
    throw new Error(`Run ${runId} is ${run.status}, expected RUNNING`);
  }
  return prisma.aiTrialRun.update({
    where: { id: runId },
    data: { status: "PAUSED" },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// f) stopRun
// ─────────────────────────────────────────────────────────────────────────────
export async function stopRun(runId: string): Promise<AiTrialRun> {
  const run = await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "RUNNING" && run.status !== "PAUSED") {
    throw new Error(`Run ${runId} is ${run.status}, expected RUNNING or PAUSED`);
  }

  // Mark remaining pending items as skipped
  await prisma.aiTrialItem.updateMany({
    where: { runId, status: "pending" },
    data: { status: "skipped", error: "Run stopped by admin" },
  });

  return prisma.aiTrialRun.update({
    where: { id: runId },
    data: { status: "STOPPED", finishedAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// g) getRunReport
// ─────────────────────────────────────────────────────────────────────────────
export async function getRunReport(runId: string): Promise<RunReport> {
  const run = await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });

  const skipped = await prisma.aiTrialItem.count({
    where: { runId, status: "skipped" },
  });

  const avgCostPerLead =
    run.processed > 0 ? Math.round(run.costMicroUsd / run.processed) : 0;
  const avgMs =
    run.processed > 0 ? Math.round(run.totalMs / run.processed) : 0;

  return {
    id: run.id,
    status: run.status,
    sampleSize: run.sampleSize,
    team: run.team,
    source: run.source,
    features: run.features.split(",").filter(Boolean),
    provider: run.provider,
    model: run.model,
    totalLeads: run.totalLeads,
    processed: run.processed,
    failed: run.failed,
    skipped,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costMicroUsd: run.costMicroUsd,
    estCostMicroUsd: run.estCostMicroUsd,
    avgCostPerLead,
    avgMs,
    createdById: run.createdById,
    createdAt: run.createdAt,
    confirmedAt: run.confirmedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    qualityNote: run.qualityNote,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// h) clearRunOutputs
// ─────────────────────────────────────────────────────────────────────────────
export async function clearRunOutputs(runId: string): Promise<AiTrialRun> {
  // Verify run exists
  await prisma.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });

  // Delete all items and reset counters in a transaction
  const run = await prisma.$transaction(async (tx) => {
    await tx.aiTrialItem.deleteMany({ where: { runId } });

    // Re-create items from the original sample (re-sample leads)
    const originalRun = await tx.aiTrialRun.findUniqueOrThrow({ where: { id: runId } });
    const features = originalRun.features.split(",").filter(Boolean);

    const whereClause: Record<string, unknown> = {};
    if (originalRun.team) whereClause.forwardedTeam = originalRun.team;
    if (originalRun.source) whereClause.source = originalRun.source;

    const leads = await tx.lead.findMany({
      where: whereClause,
      select: { id: true },
      orderBy: { createdAt: "asc" },
      take: originalRun.sampleSize,
    });

    const itemData = [];
    for (const lead of leads) {
      for (const feature of features) {
        itemData.push({
          runId,
          leadId: lead.id,
          feature,
          status: "pending",
        });
      }
    }

    if (itemData.length > 0) {
      await tx.aiTrialItem.createMany({ data: itemData });
    }

    return tx.aiTrialRun.update({
      where: { id: runId },
      data: {
        status: "DRAFT",
        processed: 0,
        failed: 0,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        totalMs: 0,
        totalLeads: leads.length,
        confirmedAt: null,
        startedAt: null,
        finishedAt: null,
      },
    });
  });

  return run;
}

// ─────────────────────────────────────────────────────────────────────────────
// i) listRuns
// ─────────────────────────────────────────────────────────────────────────────
export async function listRuns(): Promise<RunReport[]> {
  const runs = await prisma.aiTrialRun.findMany({
    orderBy: { createdAt: "desc" },
  });

  // Count skipped items per run in one batch query
  const runIds = runs.map(r => r.id);
  const skippedCounts = await prisma.aiTrialItem.groupBy({
    by: ["runId"],
    where: { runId: { in: runIds }, status: "skipped" },
    _count: { _all: true },
  });
  const skippedMap = new Map(skippedCounts.map(s => [s.runId, s._count._all]));

  return runs.map((run) => {
    const skipped = skippedMap.get(run.id) ?? 0;
    const avgCostPerLead =
      run.processed > 0 ? Math.round(run.costMicroUsd / run.processed) : 0;
    const avgMs =
      run.processed > 0 ? Math.round(run.totalMs / run.processed) : 0;

    return {
      id: run.id,
      status: run.status,
      sampleSize: run.sampleSize,
      team: run.team,
      source: run.source,
      features: run.features.split(",").filter(Boolean),
      provider: run.provider,
      model: run.model,
      totalLeads: run.totalLeads,
      processed: run.processed,
      failed: run.failed,
      skipped,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costMicroUsd: run.costMicroUsd,
      estCostMicroUsd: run.estCostMicroUsd,
      avgCostPerLead,
      avgMs,
      createdById: run.createdById,
      createdAt: run.createdAt,
      confirmedAt: run.confirmedAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      qualityNote: run.qualityNote,
    };
  });
}

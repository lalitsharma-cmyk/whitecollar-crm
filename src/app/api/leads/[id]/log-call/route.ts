import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { generateConversationSummary, aiEnabled } from "@/lib/ai";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));

  const outcome = body.outcome as CallOutcome;
  const remarks = String(body.remarks ?? "").trim();
  // Duration must be a non-negative integer. Belt-and-braces against any client
  // that bypasses the UI's min={0} (manual API call, browser quirk, paste of "-30").
  const durationRaw = Number(body.durationSec ?? 0);
  const durationSec = !isFinite(durationRaw) || durationRaw < 0 ? 0 : Math.floor(durationRaw);
  const direction = (body.direction as CallDirection) ?? CallDirection.OUTBOUND;
  // Optional scheduled callback time (ISO string from the IST picker on the UI).
  // When set, we update Lead.followupDate so the pre-meeting cron's
  // 10-min-before push fires and it shows on the morning briefing card.
  const callbackAtRaw = body.callbackAt ? String(body.callbackAt) : "";
  const callbackAt = callbackAtRaw ? new Date(callbackAtRaw) : null;
  if (callbackAtRaw && (!callbackAt || isNaN(callbackAt.getTime()) || callbackAt.getTime() <= Date.now())) {
    return NextResponse.json({ error: "Callback time must be a valid future ISO datetime" }, { status: 400 });
  }

  if (!outcome || !Object.values(CallOutcome).includes(outcome)) {
    return NextResponse.json({ error: "Outcome is required" }, { status: 400 });
  }
  // Remarks are OPTIONAL on every outcome (Lalit's policy). Agent can save a
  // bare outcome like "not picked" without writing anything.

  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const now = new Date();

  await prisma.callLog.create({
    data: {
      leadId: id,
      userId: me.id,
      direction,
      phoneNumber: lead.phone ?? "(no number)",
      durationSec: durationSec > 0 ? durationSec : undefined,
      outcome,
      notes: remarks || undefined,  // empty remarks → null in DB (cleaner than empty string)
      startedAt: now,
    },
  });
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.CALL,
      status: ActivityStatus.DONE,
      title: `Call · ${outcome.replaceAll("_", " ")}`,
      description: remarks || undefined,
      completedAt: now,
    },
  });
  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: now,
      // Clear the SLA flag — call has been made, so future breaches can re-notify
      slaEscalated: false,
      // If the agent scheduled a specific callback time, write it to followupDate
      // so the pre-meeting cron picks it up. Also reset the dedupe flag so the
      // 10-min push fires for this new time even if the previous followupDate
      // already had a reminder sent.
      ...(callbackAt ? {
        followupDate: callbackAt,
        followupReminderSentAt: null,
      } : {}),
    },
  });
  // Fire-and-forget behavioural re-score — small, cheap, OK to drop on teardown.
  rescoreLead(id).catch(() => {});

  // AI summary refresh — AWAITED so Vercel's serverless function teardown
  // can't kill it mid-flight (the previous fire-and-forget was silently dying
  // after NextResponse returned, which is why Lalit reported "Ai also does not
  // update"). Adds ~1-3s to the log-call response but the call action is
  // already a user wait state ("Saving…") so an extra second is acceptable
  // in exchange for actually working. Wrapped in try/catch so a Gemini error
  // never blocks the call from being recorded.
  if (aiEnabled()) {
    try {
      await refreshAiSummary(id);
    } catch (e) {
      console.error("refreshAiSummary failed", e);
    }
  }

  return NextResponse.json({ ok: true });
}

async function refreshAiSummary(leadId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { callLogs: { orderBy: { startedAt: "desc" }, take: 10 } },
  });
  if (!lead) return;
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
  if (!result) return;
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      aiSummary: result.summary || lead.aiSummary,
      aiNextAction: result.nextAction || lead.aiNextAction,
      aiUpdatedAt: new Date(),
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus, LeadStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { awardXp, bumpStreak, type AwardResult } from "@/lib/gamification.server";
import { aiLive } from "@/lib/ai";
import { runAIExtraction } from "@/lib/aiExtractor";

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
  // Scheduled follow-up / callback time (ISO string from the IST picker on the UI).
  // Now MANDATORY for every logged conversation — we always update Lead.followupDate
  // so the pre-meeting cron's 10-min-before push fires and the lead surfaces on the
  // morning briefing / Action List. Mirror of the client-side rule; enforced here
  // too so a tampered request can't bypass it.
  const callbackAtRaw = body.callbackAt ? String(body.callbackAt) : "";
  const callbackAt = callbackAtRaw ? new Date(callbackAtRaw) : null;

  // ── MANDATORY-FIELD VALIDATION (server-side mirror of the Log Conversation form).
  //    Order matches the form: outcome → follow-up → remarks. Any miss → 400, no write.
  if (!outcome || !Object.values(CallOutcome).includes(outcome)) {
    return NextResponse.json({ error: "Please select an outcome before saving." }, { status: 400 });
  }
  if (!callbackAtRaw) {
    return NextResponse.json({ error: "Please set the next follow-up date." }, { status: 400 });
  }
  if (!callbackAt || isNaN(callbackAt.getTime()) || callbackAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Follow-up time must be a valid future ISO datetime." }, { status: 400 });
  }
  if (!remarks) {
    return NextResponse.json({ error: "Please add remarks before saving." }, { status: 400 });
  }

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
      // Persist the structured outcome + follow-up ON the timeline entry itself so
      // the Smart Timeline card renders the outcome chip + "📅 Follow-up:" line, and
      // so the upcoming "activity-required-before-complete" workflow can key off a
      // valid contact activity (outcome + followupDate present) logged today.
      outcome: outcome.replaceAll("_", " "),
      followupDate: callbackAt,
      completedAt: now,
    },
  });
  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: now,
      // Clear the SLA flag — call has been made, so future breaches can re-notify
      slaEscalated: false,
      // Follow-up date is mandatory now, so always write it to Lead.followupDate
      // (the pre-meeting cron picks it up) and reset the dedupe flag so the 10-min
      // push fires for this new time even if the previous followupDate already had
      // a reminder sent.
      followupDate: callbackAt,
      followupReminderSentAt: null,
    },
  });
  // Auto-advance: if this lead is still NEW and a call was just logged, move it to CONTACTED
  // so the status reflects that conversation has started.
  if (lead.status === LeadStatus.NEW) {
    await prisma.lead.update({
      where: { id },
      data: { status: LeadStatus.CONTACTED },
    });
  }

  // Fire-and-forget behavioural re-score — rule-based, doesn't need AI.
  rescoreLead(id).catch(() => {});

  // Fire-and-forget AI extraction — only when AI is live and call has notes.
  if (remarks) {
    aiLive().then((on) => {
      if (on) runAIExtraction(id, "call_log", { leadId: id }).catch(() => {});
    }).catch(() => {});
  }

  // ── Gamification: award XP + bump streaks.
  // Connected/Interested also count as a connected-call bonus. Order matters:
  // we await the FIRST award so we can return its result for the client toast,
  // then fire-and-forget the bonus. Streaks update in the background.
  let awarded: AwardResult | null = null;
  try {
    awarded = await awardXp(me.id, "CALL_LOGGED");
    if (outcome === CallOutcome.CONNECTED || outcome === CallOutcome.INTERESTED) {
      // For toast UX, prefer the larger CALL_CONNECTED reward as the headline
      // award. Both still credit XP — the agent sees the bigger number.
      const connected = await awardXp(me.id, "CALL_CONNECTED");
      if (connected) awarded = connected;
    }
    bumpStreak(me.id, "daily").catch(() => {});
    // Cold-call streak only ticks if THIS call was on a cold-data lead.
    if (lead.phone) {
      const isCold = await prisma.lead.findUnique({ where: { id }, select: { isColdCall: true } });
      if (isCold?.isColdCall) bumpStreak(me.id, "coldCall").catch(() => {});
    }
  } catch {
    // Never let gamification break the call save.
  }

  return NextResponse.json({
    ok: true,
    awardedXp: awarded
      ? {
          amount: awarded.awarded,
          label: awarded.label,
          newXp: awarded.newXp,
          leveledUp: awarded.leveledUp,
          newLevel: awarded.leveledUp ? awarded.newLevel : null,
        }
      : null,
  });
}

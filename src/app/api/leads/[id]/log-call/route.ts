import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus, LeadStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { callOutcomeLabel } from "@/lib/callOutcome";
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
  // NOTE: logging a call/WhatsApp no longer sets the follow-up date (Lalit's rule:
  // an agent must NEVER set/edit the follow-up while logging a conversation — the
  // follow-up changes ONLY via Complete / Snooze / Escalate / Reschedule / Admin).
  // We deliberately do NOT read, require, or persist `callbackAt`/`followupDate`
  // here. After the agent saves, the UI opens the "What next?" popup so they close
  // the follow-up through the shared action endpoints.

  // ── MANDATORY-FIELD VALIDATION (server-side mirror of the Log Conversation form).
  //    Outcome + remarks remain MANDATORY (follow-up is intentionally removed).
  //    Any miss → 400, no write.
  if (!outcome || !Object.values(CallOutcome).includes(outcome)) {
    return NextResponse.json({ error: "Please select an outcome before saving." }, { status: 400 });
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
      title: `Call · ${callOutcomeLabel(outcome)}`,
      description: remarks || undefined,
      // Persist the structured outcome ON the timeline entry itself so the Smart
      // Timeline card renders the outcome chip, and so the completion-gate can key
      // off a valid contact activity (a CALL/WHATSAPP logged today). We do NOT set
      // followupDate here — logging a conversation no longer sets the follow-up.
      // callOutcomeLabel = the ONE shared formatter (identical output to the prior
      // inline replaceAll) every CALL write path + the backfill now funnel through.
      outcome: callOutcomeLabel(outcome),
      completedAt: now,
    },
  });
  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: now,
      // Clear the SLA flag — call has been made, so future breaches can re-notify
      slaEscalated: false,
      // Follow-up is NOT touched here. Logging a call/WhatsApp must not set or
      // change Lead.followupDate — that happens only via Complete / Snooze /
      // Escalate / Reschedule / Admin (the "What next?" popup opens after save).
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

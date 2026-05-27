import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { awardXp, bumpStreak, type AwardResult } from "@/lib/gamification.server";

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
  // Fire-and-forget behavioural re-score — rule-based, doesn't need AI.
  rescoreLead(id).catch(() => {});

  // AI auto-summary refresh REMOVED — Lalit gave up on Gemini after the free
  // tier returned NOT_FOUND for every model variant. Re-wire here if/when a
  // working AI provider is added (or billing is enabled on Google Cloud).
  // The generateConversationSummary helper still lives in src/lib/ai.ts.

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

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";

/**
 * POST /api/leads/[id]/action-snooze
 *
 * "Snooze" button on the Action List card. Pushes the follow-up out by a
 * preset window so the card disappears from Today / Overdue but the lead
 * stays in the agent's queue for later.
 *
 * Body (one of):
 *   { hours?: number }     – preset: 1, 4, 24 (Snooze 1h / 4h / Tomorrow)
 *   { days?: number }      – preset: 1, 3, 7
 *   { at?: string }        – explicit ISO datetime (the Lead-View picker sends
 *                            "YYYY-MM-DDTHH:mm:00+05:30" so it lands at an exact
 *                            IST wall-clock time, not "+N hours from now")
 *
 * If none is given we default to +24h. Resets `followupReminderSentAt`
 * so the pre-meeting cron's 10-min-before push fires again at the new time.
 *
 * Snoozing does NOT touch lastTouchedAt — the goal is to delay, not to claim
 * the agent has actually contacted the client.
 *
 * Shared by /action-list (ActionCardClient presets) and /leads/[id]
 * (LeadFollowupActions explicit picker) — one endpoint, DRY.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const body = await req.json().catch(() => ({}));

  // ── Explicit datetime path (Lead-View picker) ──────────────────────────
  // Takes precedence over hours/days. Must be a valid, FUTURE instant.
  let newFollowup: Date;
  let label: string;
  const atRaw = typeof body.at === "string" ? body.at.trim() : "";
  const atMs = atRaw ? Date.parse(atRaw) : NaN;
  if (atRaw && !isNaN(atMs)) {
    if (atMs <= Date.now()) {
      return NextResponse.json({ error: "Pick a future date/time." }, { status: 400 });
    }
    newFollowup = new Date(atMs);
    label = newFollowup.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  } else {
    const hoursRaw = Number(body.hours ?? 0);
    const daysRaw = Number(body.days ?? 0);
    const hours = isFinite(hoursRaw) && hoursRaw > 0 ? Math.min(hoursRaw, 24 * 14) : 0;
    const days = isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 14) : 0;
    const totalMs = hours > 0
      ? hours * 3600 * 1000
      : (days > 0 ? days * 24 * 3600 * 1000 : 24 * 3600 * 1000);

    newFollowup = new Date(Date.now() + totalMs);
    label = hours > 0
      ? (hours === 1 ? "1 hour" : hours < 24 ? `${hours} hours` : `${Math.round(hours/24)} day${hours/24 === 1 ? "" : "s"}`)
      : (days === 1 ? "1 day" : `${days} days`);
  }

  await prisma.lead.update({
    where: { id },
    data: {
      followupDate: newFollowup,
      followupReminderSentAt: null,
      // Snooze does NOT mark needsManagerReview false — the agent is buying
      // themselves time, not telling the manager the flag is resolved.
    },
  });

  const whenIST = newFollowup.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      // Explicit-datetime path: label IS the target time, so don't repeat it.
      title: atRaw && !isNaN(atMs) ? `⏸ Follow-up snoozed to ${label}` : `⏸ Snoozed ${label}`,
      description: `Next follow-up at ${whenIST} IST`,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    leadName: lead.name,
    followupDate: newFollowup.toISOString(),
    snoozedFor: label,
  });
}

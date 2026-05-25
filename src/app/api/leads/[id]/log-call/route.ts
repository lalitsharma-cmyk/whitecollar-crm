import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));

  const outcome = body.outcome as CallOutcome;
  const remarks = String(body.remarks ?? "").trim();
  const durationSec = Number(body.durationSec ?? 0);
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
  if (!remarks || remarks.length < 3) {
    return NextResponse.json({ error: "Remarks required (minimum 3 characters)" }, { status: 400 });
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
      notes: remarks,
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
      description: remarks,
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
  // Fire-and-forget behavioural re-score. Never block / fail the user action.
  rescoreLead(id).catch(() => {});
  return NextResponse.json({ ok: true });
}

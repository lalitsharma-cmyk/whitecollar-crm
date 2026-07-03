import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { CALL_OUTCOME_INITIATED } from "@/lib/callOutcome";
import { loadOwnedLead } from "@/lib/leadScope";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.CALL,
      status: ActivityStatus.DONE,
      title: "📞 Call initiated",
      description: "Agent tapped Call button",
      // A tap is a dial with no result yet — stamp a non-null "Initiated" outcome
      // so click-to-call rows never erode the CALL-outcome integrity invariant.
      // The real outcome lands on a separate Activity when the agent logs the call.
      outcome: CALL_OUTCOME_INITIATED,
    },
  });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: new Date() } }).catch(() => {});
  return NextResponse.json({ ok: true });
}

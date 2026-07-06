import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, name: true, phone: true, leadOrigin: true, status: true, ownerId: true, forwardedTeam: true } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lead.leadOrigin !== "COLD" && lead.leadOrigin !== "REVIVAL") return NextResponse.json({ error: "Already an active lead" }, { status: 400 });
  // Scope guard — AGENT may only promote their own cold lead, MANAGER only within their team.
  if (!(await canTouchLead(me, { ownerId: lead.ownerId, forwardedTeam: lead.forwardedTeam }))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date();
  await prisma.lead.update({
    where: { id },
    data: {
      leadOrigin: "ACTIVE_LEAD",
      isColdCall: false,
      lastTouchedAt: now,
    },
  });
  // Write the COLD_TO_LEAD activity (parity with /promote-cold) so the Revival
  // "promoted today" counter + weekly revival leaderboard — both of which tally
  // this activity — reflect the promotion. Without it those counts undercounted.
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.COLD_TO_LEAD,
      status: ActivityStatus.DONE,
      title: `❄ → 🔥 Promoted cold-data prospect to active lead`,
      description: `${lead.name} (${lead.phone ?? "no phone"}) — promoted to active lead by ${me.name}`,
      completedAt: now,
    },
  });
  await audit({ userId: me.id, action: "lead.promote_from_cold", entity: "Lead", entityId: id, request: reqMeta(req) });
  return NextResponse.json({ ok: true });
}

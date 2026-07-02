import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTouchBuyer } from "@/lib/buyerScope";

// ── Buyer agent-handling history + activity timeline (read) ──────────────────
// The 5b UI renders these; this is the queryable read path. Returns, for one
// buyer the caller may see (canTouchBuyer — admin any; assigned agent their own):
//   • assignments: every stint (which agent handled it, assignedAt, returnedAt,
//     returnReason, attemptsInStint) — the admin-visible handling history.
//   • activities:  the full BuyerActivity timeline (calls/notes/wa/voice/attempts +
//     ASSIGNED/RETURNED/CONVERTED/REJECTED), newest first.
//   • record:      current lifecycle fields (poolStatus, ownerId, attemptCount,
//     convertedLeadId, rejection fields).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({
    where: { id },
    select: {
      id: true, clientName: true, poolStatus: true, ownerId: true, assignedAt: true,
      attemptCount: true, remarks: true, convertedLeadId: true, convertedAt: true,
      convertedById: true, rejectedAt: true, rejectedById: true, rejectionReason: true,
      returnedToPoolAt: true, deletedAt: true, market: true,
      owner: { select: { id: true, name: true } },
    },
  });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt, market: buyer.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [assignments, activities, calls] = await Promise.all([
    prisma.buyerAssignment.findMany({
      where: { buyerId: id },
      orderBy: { assignedAt: "asc" },
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.buyerActivity.findMany({
      where: { buyerId: id },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
      take: 500,
    }),
    // Telephony calls auto-linked to this buyer that carry a recording — rendered
    // as scope-proxied players in the timeline (parity with the Lead call history).
    prisma.callLog.findMany({
      where: { buyerId: id, recordingUrl: { not: null } },
      orderBy: { startedAt: "desc" },
      select: { id: true, direction: true, outcome: true, durationSec: true, startedAt: true, ivrProvider: true },
      take: 100,
    }),
  ]);

  return NextResponse.json({
    record: buyer,
    assignments: assignments.map((a) => ({
      id: a.id,
      agent: a.user?.name ?? null,
      agentId: a.userId,
      assignedAt: a.assignedAt,
      assignedById: a.assignedById,
      returnedAt: a.returnedAt,
      returnReason: a.returnReason,
      attemptsInStint: a.attemptsInStint,
      open: a.returnedAt === null,
    })),
    activities: activities.map((ev) => ({
      id: ev.id,
      type: ev.type,
      description: ev.description,
      by: ev.user?.name ?? null,
      byId: ev.userId,
      createdAt: ev.createdAt,
    })),
    calls: calls.map((c) => ({
      id: c.id,
      direction: c.direction,
      outcome: c.outcome,
      durationSec: c.durationSec,
      startedAt: c.startedAt,
      provider: c.ivrProvider,
    })),
  });
}

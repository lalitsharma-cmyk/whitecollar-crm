import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRActivityType, HRCandidateStatus } from "@prisma/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json();

  const type = body.type as HRActivityType;
  if (!type) return NextResponse.json({ error: "type required" }, { status: 400 });

  const existing = await prisma.hRCandidate.findUnique({ where: { id }, select: { status: true } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Auto-update candidate status based on call outcome if provided
  const statusMap: Partial<Record<HRActivityType, HRCandidateStatus>> = {
    CALL_CONNECTED:    "PIPELINE",
    OFFER_RELEASED:    "OFFER_RELEASED",
    OFFER_DECLINED:    "OFFER_DECLINED",
    CANDIDATE_JOINED:  "JOINED",
  };
  const autoStatus = body.newStatus
    ? (body.newStatus as HRCandidateStatus)
    : statusMap[type];

  const updates: Record<string, unknown> = {};
  if (autoStatus && autoStatus !== existing.status) updates.status = autoStatus;
  if (body.nextAction)     updates.nextAction = body.nextAction;
  if (body.nextActionDate) updates.nextActionDate = new Date(body.nextActionDate);

  const [activity] = await prisma.$transaction([
    prisma.hRActivity.create({
      data: {
        candidateId: id,
        userId: me.id,
        type,
        notes: body.notes || null,
        oldStatus: existing.status as HRCandidateStatus,
        newStatus: (autoStatus ?? existing.status) as HRCandidateStatus,
      },
    }),
    ...(Object.keys(updates).length > 0
      ? [prisma.hRCandidate.update({ where: { id }, data: updates })]
      : []),
  ]);

  return NextResponse.json({ activity }, { status: 201 });
}

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRFollowUpType } from "@prisma/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json();

  if (!body.dueAt) return NextResponse.json({ error: "dueAt required" }, { status: 400 });

  const followUp = await prisma.hRFollowUp.create({
    data: {
      candidateId: id,
      userId: me.id,
      type: (body.type as HRFollowUpType) ?? "CALL_BACK",
      dueAt: new Date(body.dueAt),
      notes: body.notes || null,
      autoCreated: body.autoCreated ?? false,
    },
  });

  // Update candidate nextActionDate if this is sooner
  const candidate = await prisma.hRCandidate.findUnique({ where: { id }, select: { nextActionDate: true } });
  const due = new Date(body.dueAt);
  if (!candidate?.nextActionDate || due < candidate.nextActionDate) {
    await prisma.hRCandidate.update({
      where: { id },
      data: { nextAction: body.notes || followUp.type.replace(/_/g, " "), nextActionDate: due },
    });
  }

  await prisma.hRActivity.create({
    data: {
      candidateId: id, userId: me.id,
      type: "FOLLOWUP_CREATED",
      notes: `Follow-up set: ${followUp.type.replace(/_/g, " ")} on ${due.toLocaleDateString("en-IN")}`,
    },
  });

  return NextResponse.json({ followUp }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id: candidateId } = await params;
  const body = await req.json();
  const followUpId: string = body.followUpId;

  const fu = await prisma.hRFollowUp.update({
    where: { id: followUpId },
    data: { completedAt: new Date(), notes: body.notes ? body.notes : undefined },
  });

  await prisma.hRActivity.create({
    data: {
      candidateId, userId: me.id,
      type: "FOLLOWUP_COMPLETED",
      notes: body.notes || `Follow-up completed: ${fu.type.replace(/_/g, " ")}`,
    },
  });

  return NextResponse.json({ followUp: fu });
}

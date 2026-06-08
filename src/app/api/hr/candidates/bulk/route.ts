import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";

// Bulk update candidate status and/or owner from the Candidates list.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ error: "No candidates selected" }, { status: 400 });

  const data: { status?: HRCandidateStatus; primaryOwnerId?: string } = {};
  if (body.status) data.status = body.status as HRCandidateStatus;
  if (body.primaryOwnerId) data.primaryOwnerId = body.primaryOwnerId;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await prisma.hRCandidate.updateMany({ where: { id: { in: ids } }, data });

  // Leave a timeline trace on each candidate.
  const note = data.status
    ? `Bulk update: status → ${data.status.replace(/_/g, " ")}`
    : "Bulk update: owner reassigned";
  await prisma.hRActivity.createMany({
    data: ids.map(id => ({
      candidateId: id,
      userId: me.id,
      type: data.status ? ("STATUS_CHANGED" as const) : ("NOTE_ADDED" as const),
      notes: note,
      newStatus: data.status ?? null,
    })),
  });

  return NextResponse.json({ ok: true, updated: ids.length });
}

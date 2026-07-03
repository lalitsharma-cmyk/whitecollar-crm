// PATCH /api/hr/candidates/[id]/escalation — resolve an escalation thread.
// Requires hrCan("reviewEscalations") (Admin / Senior HR). Marks the thread RESOLVED,
// writes an HRActivity (ESCALATION_RESOLVED), and notifies the raiser. Body: { escalationId }.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedCandidate, hrCan } from "@/lib/hrAccess";
import { notify } from "@/lib/notify";
import { NotifKind, HRActivityType } from "@prisma/client";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me, candidate } = access;

  if (!hrCan(me, "reviewEscalations"))
    return NextResponse.json({ error: "Only a reviewer can resolve an escalation." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const escId = String(body?.escalationId ?? "").trim();
  if (!escId) return NextResponse.json({ error: "escalationId required." }, { status: 400 });

  const esc = await prisma.hREscalation.findFirst({
    where: { id: escId, candidateId: id },
    select: { id: true, status: true, raisedById: true },
  });
  if (!esc) return NextResponse.json({ error: "Escalation not found." }, { status: 404 });
  if (esc.status === "RESOLVED") return NextResponse.json({ ok: true, already: true });

  await prisma.hREscalation.update({
    where: { id: esc.id },
    data: { status: "RESOLVED", resolvedById: me.id, resolvedAt: new Date() },
  });
  await prisma.hRActivity.create({
    data: { candidateId: id, userId: me.id, type: HRActivityType.ESCALATION_RESOLVED, notes: "Escalation resolved" },
  }).catch(() => {});

  if (esc.raisedById && esc.raisedById !== me.id) {
    notify({
      userId: esc.raisedById, kind: NotifKind.SYSTEM, severity: "INFO",
      title: `✅ Escalation resolved on ${candidate.name}`,
      body: `${me.name ?? "Manager"} marked your escalation resolved.`,
      linkUrl: `/hr/candidates/${id}`,
      source: { type: "ESCALATION", id: esc.id, createdById: me.id },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

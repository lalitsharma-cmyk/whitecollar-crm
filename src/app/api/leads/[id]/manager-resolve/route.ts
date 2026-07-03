// POST /api/leads/[id]/manager-resolve — Lalit / admin / manager resolves a
// "Needs Lalit" manager escalation (Lead.needsManagerReview).
//
// Clears the flag (so the lead leaves the dashboard "Needs Lalit" count + the
// lead-detail banner), logs a resolution entry to the conversation timeline,
// and notifies the lead's owner (the agent who raised it) that it's resolved.
// Mirrors the voice-escalation resolve flow, but for the flag-based manager
// escalation that drives the dashboard count.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, NotifKind } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  // Only a manager / admin (Lalit) resolves a manager escalation. Super-admins
  // carry role ADMIN, so this covers them too.
  const isManager = me.role === "ADMIN" || me.role === "MANAGER";
  if (!isManager) {
    return NextResponse.json({ error: "Only a manager can resolve an escalation." }, { status: 403 });
  }

  // Re-read the escalation flag fields (loadOwnedLead returns a lean lead).
  const cur = await prisma.lead.findUnique({
    where: { id },
    select: { needsManagerReview: true, ownerId: true, name: true },
  });
  if (!cur) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  if (!cur.needsManagerReview) return NextResponse.json({ ok: true, already: true });

  const body = await req.json().catch(() => ({}));
  const comment = String(body.comment ?? "").trim();
  const now = new Date();

  await prisma.lead.update({
    where: { id },
    data: { needsManagerReview: false, managerReviewReason: null, flaggedAt: null },
  });

  // Resolution entry on the conversation timeline (records WHO resolved + the note).
  await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      type: ActivityType.NOTE,
      status: ActivityStatus.DONE,
      title: `✅ Escalation resolved by ${me.name}`,
      description: comment || "Marked resolved — no further action needed.",
      actionContext: "escalate-resolved",
      completedAt: now,
    },
  });

  // Tell the agent (lead owner) their escalation was resolved.
  if (cur.ownerId && cur.ownerId !== me.id) {
    notify({
      userId: cur.ownerId,
      kind: NotifKind.SYSTEM,
      severity: "INFO",
      title: `✅ Your escalation for ${cur.name} has been resolved by ${me.name}`,
      body: comment || "No further action needed.",
      linkUrl: `/leads/${id}`,
      leadId: id,
      source: { type: "ESCALATION", id, createdById: me.id },
    }).catch(() => {});
  }

  await audit({
    userId: me.id,
    action: "lead.escalation.resolve",
    entity: "Lead",
    entityId: id,
    meta: { comment: comment || null },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

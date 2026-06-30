import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { audit, reqMeta } from "@/lib/audit";
import { canEditRemark } from "@/lib/remarkPerms";

/**
 * PATCH /api/leads/[id]/calls/[callId]   body: { notes }
 *
 * Edit the REMARK on a call in the conversation history (CallLog.notes) IN PLACE.
 * Call remarks are the bulk of what agents log, so they're the common "conversation
 * history remark" — this gives them the same edit rule + audit as notes / meetings.
 *
 * PERMISSION (shared canEditRemark — same rule as notes, re-enforced server-side):
 *   • ADMIN / Super-Admin / MANAGER → edit ANY call remark, ANY date.
 *   • AGENT → ONLY their OWN call (CallLog.userId) and ONLY on the IST calendar day
 *     they logged it (CallLog.startedAt). From the next IST day on → 403.
 *
 * AUDIT — the original remark is preserved in RemarkAuditLog (action EDIT_CALL,
 * remarkKey = callId, old → new + who + when) AND LeadFieldHistory. The call row is
 * updated in place, never deleted; the conversation history shows the latest text
 * plus an "Edited by …" marker.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; callId: string }> },
) {
  const { id, callId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  const call = await prisma.callLog.findUnique({
    where: { id: callId },
    select: { id: true, leadId: true, userId: true, startedAt: true, notes: true },
  });
  if (!call || call.leadId !== id) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Shared rule — super-admins are role ADMIN; agents need own + same-IST-day.
  const role = me.isSuperAdmin === true ? "ADMIN" : me.role;
  if (!canEditRemark({ id: me.id, role }, { createdById: call.userId, createdAt: call.startedAt })) {
    return NextResponse.json(
      { error: "You can only edit your own call remark, and only on the day you logged it." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = body.notes !== undefined ? body.notes : body.remark;
  const next = raw === null ? null : String(raw ?? "").trim().slice(0, 5000) || null;
  const old = call.notes ?? null;
  if (next === old) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.$transaction(async (tx) => {
    await tx.callLog.update({ where: { id: callId }, data: { notes: next } });
    // Audit row — keyed by callId + action EDIT_CALL so the lead page can build an
    // editedCalls map (callId → who/when) for the "Edited by …" badge.
    await tx.remarkAuditLog.create({
      data: {
        leadId: id,
        remarkKey: callId,
        action: "EDIT_CALL",
        actorId: me.id,
        actorName: me.name,
        oldState: old,
        newState: next,
      },
    });
    await tx.leadFieldHistory.create({
      data: {
        leadId: id,
        field: "call-remark",
        oldValue: (old ?? "").slice(0, 2000),
        newValue: (next ?? "").slice(0, 2000),
        changedById: me.id,
        source: "call-remark-edit",
      },
    });
  });

  await audit({
    userId: me.id,
    action: "call.remark.edit",
    entity: "CallLog",
    entityId: callId,
    meta: { leadId: id },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}

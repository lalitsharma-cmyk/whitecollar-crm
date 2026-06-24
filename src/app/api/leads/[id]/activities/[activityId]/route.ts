import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { audit, reqMeta } from "@/lib/audit";
import { ActivityType } from "@prisma/client";

/**
 * PATCH /api/leads/[id]/activities/[activityId]
 *   body: { type?, outcome?, description?, completedAt?, scheduledAt?, followupDate? }
 *
 * Edit a Smart Timeline entry (a CRM Activity row) IN PLACE.
 *
 * PERMISSION — ADMIN / Super-Admin ONLY. Agents CANNOT edit historical timeline
 * records; this returns 403 for any non-admin even if the UI button is hidden
 * (defence in depth — a tampered request from an agent must 403).
 *
 * AUDIT — the prior value of every changed field is preserved in ActivityEdit
 * (old → new + who + when) AND LeadFieldHistory. The timeline shows the LATEST
 * value; the audit retains the full edit history. NO timeline data is lost —
 * the entry is updated in place, never deleted, and Raw History (Lead.rawRemarks)
 * is never touched.
 *
 * FOLLOW-UP — when the edit sets `followupDate`, the Activity's own followupDate
 * is updated AND mirrored onto Lead.followupDate so the scheduling surfaces stay
 * consistent.
 *
 * Datetime fields accept an IST wall-clock string with offset ("YYYY-MM-DDTHH:mm:00+05:30")
 * or any value `new Date()` parses; null clears the field.
 */

// ActivityTypes that may be SET via the edit modal. We deliberately restrict to
// the conversation/timeline event types — CALL / WHATSAPP / NOTE keep their own
// dedicated rows and are not re-typed here.
const EDITABLE_TYPES = new Set<ActivityType>([
  ActivityType.SITE_VISIT,
  ActivityType.OFFICE_MEETING,
  ActivityType.VIRTUAL_MEETING,
  ActivityType.HOME_VISIT,
  ActivityType.EXPO_MEETING,
  ActivityType.MEETING,
  ActivityType.STATUS_CHANGE,
  ActivityType.LEAD_CREATED,
  ActivityType.COLD_TO_LEAD,
  ActivityType.BROCHURE_SENT,
  ActivityType.PROJECT_DISCUSSED,
  ActivityType.REMINDER_FIRED,
  ActivityType.EMAIL,
  ActivityType.TASK,
]);

/** Parse a datetime input: undefined → leave unchanged; null/"" → clear; else Date. */
function parseDateField(v: unknown): { provided: boolean; value: Date | null } {
  if (v === undefined) return { provided: false, value: null };
  if (v === null || v === "") return { provided: true, value: null };
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return { provided: false, value: null }; // ignore garbage rather than 400 the whole edit
  return { provided: true, value: d };
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> },
) {
  const { id, activityId } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;

  // ── PERMISSION: ADMIN / Super-Admin only (server-enforced) ──
  // Agents (and managers) may ADD activities elsewhere, but editing a historical
  // timeline entry is admin-only. isSuperAdmin is a flag layered on the ADMIN
  // role, so `role === "ADMIN"` already covers Lalit; we also accept the flag
  // explicitly for robustness.
  const isAdmin = me.role === "ADMIN" || me.isSuperAdmin === true;
  if (!isAdmin) {
    return NextResponse.json(
      { error: "Only an admin can edit timeline entries." },
      { status: 403 },
    );
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true, leadId: true, type: true, status: true, title: true,
      description: true, scheduledAt: true, completedAt: true,
      outcome: true, followupDate: true,
    },
  });
  // Defence in depth — the activity must belong to the lead in the URL.
  if (!activity || activity.leadId !== id) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  // ── Build the diff (only changed fields) ──
  const data: Record<string, unknown> = {};
  const edits: { field: string; oldValue: string | null; newValue: string | null }[] = [];

  // type
  if (typeof body.type === "string" && body.type.trim()) {
    const t = body.type.trim() as ActivityType;
    if (!EDITABLE_TYPES.has(t)) {
      return NextResponse.json({ error: "Invalid activity type." }, { status: 400 });
    }
    if (t !== activity.type) {
      data.type = t;
      edits.push({ field: "type", oldValue: activity.type, newValue: t });
    }
  }

  // outcome (free text, nullable)
  if (body.outcome !== undefined) {
    const next = body.outcome === null ? null : String(body.outcome).trim().slice(0, 200) || null;
    if (next !== (activity.outcome ?? null)) {
      data.outcome = next;
      edits.push({ field: "outcome", oldValue: activity.outcome ?? null, newValue: next });
    }
  }

  // description (remark text) — accept `description` or `remark`
  if (body.description !== undefined || body.remark !== undefined) {
    const raw = body.description !== undefined ? body.description : body.remark;
    const next = raw === null ? null : String(raw).trim().slice(0, 5000) || null;
    if (next !== (activity.description ?? null)) {
      data.description = next;
      edits.push({ field: "description", oldValue: activity.description ?? null, newValue: next });
    }
  }

  // completedAt (the entry's effective date/time for most timeline rows)
  {
    const { provided, value } = parseDateField(body.completedAt);
    if (provided) {
      const oldIso = isoOrNull(activity.completedAt);
      const newIso = isoOrNull(value);
      if (oldIso !== newIso) {
        data.completedAt = value;
        edits.push({ field: "completedAt", oldValue: oldIso, newValue: newIso });
      }
    }
  }

  // scheduledAt (for planned/future entries)
  {
    const { provided, value } = parseDateField(body.scheduledAt);
    if (provided) {
      const oldIso = isoOrNull(activity.scheduledAt);
      const newIso = isoOrNull(value);
      if (oldIso !== newIso) {
        data.scheduledAt = value;
        edits.push({ field: "scheduledAt", oldValue: oldIso, newValue: newIso });
      }
    }
  }

  // followupDate (per-entry; also mirrored onto the lead below)
  let followupChange: { provided: boolean; value: Date | null } = { provided: false, value: null };
  {
    const parsed = parseDateField(body.followupDate);
    followupChange = parsed;
    if (parsed.provided) {
      const oldIso = isoOrNull(activity.followupDate);
      const newIso = isoOrNull(parsed.value);
      if (oldIso !== newIso) {
        data.followupDate = parsed.value;
        edits.push({ field: "followupDate", oldValue: oldIso, newValue: newIso });
      }
    }
  }

  if (edits.length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  // ── Persist everything in one transaction: update Activity in place, write the
  // per-field audit rows, mirror follow-up to the lead, and add LeadFieldHistory. ──
  await prisma.$transaction(async (tx) => {
    await tx.activity.update({ where: { id: activityId }, data });

    await tx.activityEdit.createMany({
      data: edits.map((e) => ({
        activityId,
        leadId: id,
        field: e.field,
        oldValue: e.oldValue,
        newValue: e.newValue,
        editedById: me.id,
        editedByName: me.name,
      })),
    });

    // LeadFieldHistory — one consolidated row so the lead's Change History also
    // reflects that a timeline entry was edited (per-field detail lives in ActivityEdit).
    await tx.leadFieldHistory.create({
      data: {
        leadId: id,
        field: "activity",
        oldValue: JSON.stringify(
          Object.fromEntries(edits.map((e) => [e.field, e.oldValue])),
        ).slice(0, 2000),
        newValue: JSON.stringify(
          Object.fromEntries(edits.map((e) => [e.field, e.newValue])),
        ).slice(0, 2000),
        changedById: me.id,
        source: "timeline-edit",
      },
    });

    // Mirror an explicit follow-up edit onto the lead so /scheduling + Action List stay in sync.
    if (followupChange.provided) {
      await tx.lead.update({
        where: { id },
        data: { followupDate: followupChange.value },
      });
    }
  });

  // Best-effort security audit (outside the tx; never blocks the response).
  await audit({
    userId: me.id,
    action: "activity.edit",
    entity: "Activity",
    entityId: activityId,
    meta: { leadId: id, fields: edits.map((e) => e.field) },
    request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({ ok: true, edited: edits.map((e) => e.field) });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, LeadStatus, AIScore, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getTestingModeEnabled } from "@/lib/settings";

// Inline-edit endpoint — accepts one or more field updates and logs an Activity
// for status/stage changes. Only allows whitelisted fields.

const ALLOWED: Record<string, "string" | "date" | "number" | "enum" | "bool"> = {
  name: "string", altName: "string", phone: "string", altPhone: "string", email: "string", company: "string",
  city: "string", country: "string", address: "string",
  configuration: "string", currentStatus: "string", categorization: "string",
  tags: "string", notesShort: "string", remarks: "string",
  whoIsClient: "string", detailShared: "string", todoNext: "string",
  budgetMin: "number", budgetMax: "number", budgetCurrency: "string",
  followupDate: "date", meetingDate: "date", siteVisitDate: "date",
  status: "enum", potential: "enum", fundReadiness: "enum",
  moodStatus: "enum", whenCanInvest: "enum",
  bantStatus: "enum", bantReason: "string",
  isColdCall: "bool", coldCallReason: "string",
  profession: "enum", linkedInUrl: "string",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ownership check: agents can only mutate leads they own; admins/managers any.
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  const activityNotes: string[] = [];

  for (const [key, raw] of Object.entries(body)) {
    if (!(key in ALLOWED)) continue;
    const kind = ALLOWED[key];
    if (raw == null || raw === "") {
      updates[key] = null;
      activityNotes.push(`${key} cleared`);
      continue;
    }
    if (kind === "string") { updates[key] = String(raw); activityNotes.push(`${key} set`); }
    else if (kind === "number") { const n = Number(raw); if (!isNaN(n)) { updates[key] = n; activityNotes.push(`${key} set to ${n}`); } }
    else if (kind === "date") { const d = new Date(String(raw)); if (!isNaN(d.getTime())) { updates[key] = d; activityNotes.push(`${key} → ${d.toISOString().slice(0,10)}`); } }
    else if (kind === "bool") {
      const b = raw === true || raw === "true" || raw === "1" || raw === 1;
      updates[key] = b;
      activityNotes.push(`${key} → ${b}`);
    }
    else if (kind === "enum") {
      updates[key] = raw;
      activityNotes.push(`${key} → ${raw}`);
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  updates.lastTouchedAt = new Date();
  // If followupDate moved, re-arm the 10-min-before reminder so the new time gets pushed.
  if ("followupDate" in updates) updates.followupReminderSentAt = null;
  await prisma.lead.update({ where: { id }, data: updates as never });

  if (activityNotes.length) {
    await prisma.activity.create({
      data: {
        leadId: id, userId: me.id,
        type: "status" in updates ? ActivityType.STATUS_CHANGE : ActivityType.NOTE,
        status: ActivityStatus.DONE,
        title: `Inline edit: ${activityNotes.length} field(s)`,
        description: activityNotes.join(", "),
        completedAt: new Date(),
      },
    });
  }

  // Fire-and-forget behavioural re-score when signals likely shifted (BANT or stage change).
  // Other inline edits don't influence the rescorer's inputs so we skip them for noise control.
  if ("bantStatus" in updates || "status" in updates) {
    rescoreLead(id).catch(() => {});
  }
  // Workflow engine — BANT/status changes are common triggers that can send
  // WhatsApp/email via workflow actions. Gate behind testing-mode so we don't
  // ping real client numbers during go-live data testing.
  const testingMode = await getTestingModeEnabled();
  if (!testingMode) {
    if ("bantStatus" in updates) {
      fireWorkflowTrigger("BANT_CHANGED", id, { newBant: updates.bantStatus }).catch(() => {});
    }
    if ("status" in updates) {
      fireWorkflowTrigger("STATUS_CHANGED", id, { newStatus: updates.status }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, updated: Object.keys(updates).length - 1 });
}

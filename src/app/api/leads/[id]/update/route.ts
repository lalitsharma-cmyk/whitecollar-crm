import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ActivityType, ActivityStatus, LeadStatus, AIScore, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";

// Inline-edit endpoint — accepts one or more field updates and logs an Activity
// for status/stage changes. Only allows whitelisted fields.

const ALLOWED: Record<string, "string" | "date" | "number" | "enum"> = {
  name: "string", phone: "string", email: "string", company: "string",
  city: "string", country: "string", address: "string",
  configuration: "string", currentStatus: "string", categorization: "string",
  tags: "string", notesShort: "string", remarks: "string",
  whoIsClient: "string", detailShared: "string", todoNext: "string",
  budgetMin: "number", budgetMax: "number", budgetCurrency: "string",
  followupDate: "date", meetingDate: "date", siteVisitDate: "date",
  status: "enum", potential: "enum", fundReadiness: "enum",
  moodStatus: "enum", whenCanInvest: "enum",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
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
    else if (kind === "enum") {
      updates[key] = raw;
      activityNotes.push(`${key} → ${raw}`);
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  updates.lastTouchedAt = new Date();
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

  return NextResponse.json({ ok: true, updated: Object.keys(updates).length - 1 });
}

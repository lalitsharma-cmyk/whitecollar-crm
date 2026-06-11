// GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns calendar events (follow-ups, meetings, site visits) for the date range,
// scoped to the caller's role:
//   AGENT   → only events on leads they own
//   MANAGER → events on leads in their team (forwardedTeam match)
//   ADMIN   → all events
//
// Event sources:
//   1. Lead.followupDate  → type "followup"
//   2. Lead.meetingDate   → type "meeting"
//   3. Lead.siteVisitDate → type "site_visit"
//   4. Activity.scheduledAt (SITE_VISIT, OFFICE_MEETING, VIRTUAL_MEETING, EXPO_MEETING, MEETING)
//      that are PLANNED/OVERDUE → type varies
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export type CalendarEvent = {
  id: string;
  type: "followup" | "meeting" | "site_visit" | "virtual" | "callback";
  label: string;
  leadId: string;
  leadName: string;
  date: string; // ISO string
  assignee: string | null;
};

export async function GET(req: NextRequest) {
  const me = await requireUser();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T23:59:59.999Z`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const scopeWhere = await leadScopeWhere(me);
  const events: CalendarEvent[] = [];

  // ── 1. Lead-level date fields ────────────────────────────────────────────
  const leads = await prisma.lead.findMany({
    where: {
      ...scopeWhere,
      OR: [
        { followupDate:  { gte: fromDate, lte: toDate } },
        { meetingDate:   { gte: fromDate, lte: toDate } },
        { siteVisitDate: { gte: fromDate, lte: toDate } },
      ],
    },
    select: {
      id: true,
      name: true,
      followupDate: true,
      meetingDate: true,
      siteVisitDate: true,
      owner: { select: { name: true } },
    },
  });

  for (const lead of leads) {
    if (lead.followupDate && lead.followupDate >= fromDate && lead.followupDate <= toDate) {
      events.push({
        id: `lead-followup-${lead.id}`,
        type: "followup",
        label: `Follow-up: ${lead.name}`,
        leadId: lead.id,
        leadName: lead.name,
        date: lead.followupDate.toISOString(),
        assignee: lead.owner?.name ?? null,
      });
    }
    if (lead.meetingDate && lead.meetingDate >= fromDate && lead.meetingDate <= toDate) {
      events.push({
        id: `lead-meeting-${lead.id}`,
        type: "meeting",
        label: `Meeting: ${lead.name}`,
        leadId: lead.id,
        leadName: lead.name,
        date: lead.meetingDate.toISOString(),
        assignee: lead.owner?.name ?? null,
      });
    }
    if (lead.siteVisitDate && lead.siteVisitDate >= fromDate && lead.siteVisitDate <= toDate) {
      events.push({
        id: `lead-sitevisit-${lead.id}`,
        type: "site_visit",
        label: `Site Visit: ${lead.name}`,
        leadId: lead.id,
        leadName: lead.name,
        date: lead.siteVisitDate.toISOString(),
        assignee: lead.owner?.name ?? null,
      });
    }
  }

  // ── 2. Activity-level scheduled events ──────────────────────────────────
  // Scope: same lead-ownership rules but via the Activity→Lead relation.
  const actWhere: Prisma.ActivityWhereInput = {
    scheduledAt: { gte: fromDate, lte: toDate },
    type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "EXPO_MEETING", "MEETING"] },
    status: { in: ["PLANNED", "OVERDUE"] },
    // Never surface activities whose lead has been deleted — applies to all
    // roles (the MANAGER branch below overwrites .lead with its scoped filter,
    // which also carries deletedAt:null).
    lead: { deletedAt: null },
  };
  if (me.role === "AGENT") {
    actWhere.userId = me.id;
  } else if (me.role === "MANAGER") {
    // Scope through the lead relation (same filter as leads above)
    actWhere.lead = scopeWhere as Prisma.LeadWhereInput;
  }
  // ADMIN: no extra restriction

  const activities = await prisma.activity.findMany({
    where: actWhere,
    select: {
      id: true,
      type: true,
      title: true,
      scheduledAt: true,
      leadId: true,
      lead: { select: { name: true } },
      user: { select: { name: true } },
    },
  });

  const ACT_TYPE_MAP: Record<string, CalendarEvent["type"]> = {
    SITE_VISIT:     "site_visit",
    OFFICE_MEETING: "meeting",
    VIRTUAL_MEETING: "virtual",
    EXPO_MEETING:   "meeting",
    MEETING:        "meeting",
  };

  for (const act of activities) {
    if (!act.scheduledAt) continue;
    events.push({
      id: `activity-${act.id}`,
      type: ACT_TYPE_MAP[act.type] ?? "meeting",
      label: act.title,
      leadId: act.leadId,
      leadName: act.lead.name,
      date: act.scheduledAt.toISOString(),
      assignee: act.user?.name ?? null,
    });
  }

  // Sort ascending by date
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return NextResponse.json({ events });
}

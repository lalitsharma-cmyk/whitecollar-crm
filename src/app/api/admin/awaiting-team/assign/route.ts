// Admin/Manager assigns a team (Dubai | India) to a lead that came in without
// one. Tagging the team is what UNBLOCKS auto-routing for that lead:
//   1. Lead.forwardedTeam is set on the row.
//   2. We immediately try round-robin within that team.
//      • If a present agent is returned → assignLeadTo() does the rest (sets
//        slaFirstCallBy, creates Assignment row, notifies the agent).
//      • If round-robin returns null (e.g. nobody on shift, or the team has
//        no active users), we leave the lead unowned. The reconciler's 5-min
//        orphan sweep will retry once the team has someone available.
//
// Role-gated to ADMIN + MANAGER. Body: { leadId, team: "Dubai" | "India" }.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { chooseOwnerForNewLead } from "@/lib/assignmentWindow";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";

const TEAMS = ["Dubai", "India"] as const;
type Team = (typeof TEAMS)[number];

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));
  const leadId = String(body.leadId ?? "");
  const teamRaw = String(body.team ?? "");
  if (!leadId || !(TEAMS as readonly string[]).includes(teamRaw)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const team = teamRaw as Team;

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Resolve routing provenance via teamRouting — uses admin_queue method since
  // this is explicitly a human pulling a lead out of the awaiting-team queue.
  const routing = resolveTeam({ forceTeam: team, forceMethod: "admin_queue" });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      forwardedTeam: team,
      ...routingFieldsFor(routing),
    },
  });

  // Try to round-robin immediately so the agent gets pinged now rather than
  // waiting for the reconciler's next pass. Use chooseOwnerForNewLead so the
  // picker is SHIFT-AWARE — only PRESENT/LATE agents (per today's Attendance)
  // are eligible. If no one is clocked-in, leave the lead unowned and let the
  // reconciler's 5-min sweep pick it up once someone is available.
  const choice = await chooseOwnerForNewLead(team);
  let agentName: string | null = null;
  if (choice.userId) {
    await assignLeadTo(leadId, choice.userId, "auto round-robin after team tagging");
    const agent = await prisma.user.findUnique({ where: { id: choice.userId }, select: { name: true } });
    agentName = agent?.name ?? null;
  }

  await audit({
    userId: me.id,
    action: "lead.team.assign",
    entity: "Lead",
    entityId: leadId,
    meta: { team, autoAssignedTo: choice.userId ?? null, window: choice.window.kind, fallbackReason: choice.fallbackReason ?? null },
    request: reqMeta(req),
  });

  if (!choice.userId) {
    return NextResponse.json({
      ok: true,
      assignedTo: null,
      note: "Team tagged. No agent on shift right now; reconciler will retry.",
    });
  }
  return NextResponse.json({ ok: true, assignedTo: agentName });
}

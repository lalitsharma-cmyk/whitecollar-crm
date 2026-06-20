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
import { chooseOwnerForNewLead, currentWindow } from "@/lib/assignmentWindow";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";
import { getRoundRobinEnabled, getTestingModeEnabled } from "@/lib/settings";

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

  // RESPECT THE AUTO-ASSIGN KILL-SWITCH (Lalit, 2026-06-20 audit). This action
  // used to ALWAYS auto-pick an owner via the time-window round-robin — the one
  // path that auto-assigned (e.g. to Lalit in the evening window) even while
  // Round Robin was globally OFF. Now it only auto-picks when auto-assignment is
  // actually enabled; otherwise it tags the team ONLY and leaves the lead UNOWNED
  // for manual assignment.
  const autoAssignOn = !(await getTestingModeEnabled()) && (await getRoundRobinEnabled());
  const choice = autoAssignOn
    ? await chooseOwnerForNewLead(team)
    : { userId: null as string | null, window: currentWindow(), fallbackReason: "auto-assign disabled (round-robin off)" };

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
    meta: { team, autoAssignedTo: choice.userId ?? null, window: choice.window.kind, fallbackReason: choice.fallbackReason ?? null, autoAssignEnabled: autoAssignOn },
    request: reqMeta(req),
  });

  if (!choice.userId) {
    return NextResponse.json({
      ok: true,
      assignedTo: null,
      note: autoAssignOn
        ? "Team tagged. No agent on shift right now; reconciler will retry."
        : "Team tagged. Auto-assignment is OFF — assign an owner manually.",
    });
  }
  return NextResponse.json({ ok: true, assignedTo: agentName });
}

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";
import { prisma } from "@/lib/prisma";
import { canTouchLead } from "@/lib/leadScope";
import { crossTeamWarning, resolveTeam, routingFieldsFor, normalizeTeam } from "@/lib/teamRouting";
import { teamToMarket } from "@/lib/market";
import { snapshotLeads, logOperation } from "@/lib/operationLog";

// Manual reassign — Admin or Manager only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Fetch current lead to get its team marker before assignment.
  const lead = await prisma.lead.findUnique({ where: { id }, select: { ownerId: true, forwardedTeam: true, rejectedAt: true } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  // Team-scope guard — a MANAGER may only reassign leads in their own team (ADMIN passes).
  if (!(await canTouchLead(me, { ownerId: lead.ownerId, forwardedTeam: lead.forwardedTeam }))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  // REACTIVATE-BEFORE-REASSIGN — a rejected lead can't be assigned until it is
  // reactivated (assignLeadTo enforces this too; this is the clean early 409 that
  // also avoids applying a forceTeam write to a lead we're about to refuse).
  if (lead.rejectedAt != null) {
    return NextResponse.json({ error: "This lead is rejected — reactivate it first, then assign.", rejected: true }, { status: 409 });
  }

  // Snapshot the pre-assign state BEFORE any mutation (the forceTeam write below
  // and assignLeadTo both change routing/ownership). This is the OperationLog
  // revert source so an accidental single reassign can be undone.
  const before = await snapshotLeads(prisma, [id]);

  // If the caller is explicitly setting a team (admin pulling from awaiting-team queue),
  // resolve and write routing provenance alongside the assignment.
  const forceTeamRaw = body.forceTeam ? String(body.forceTeam) : null;
  if (forceTeamRaw) {
    const routing = resolveTeam({ forceTeam: forceTeamRaw, forceMethod: "admin_queue" });
    if (routing.team) {
      await prisma.lead.update({
        where: { id },
        data: {
          forwardedTeam: routing.team,
          // Market tracks the team being set (never leave a team-without-market gap).
          market: teamToMarket(routing.team),
          ...routingFieldsFor(routing),
        },
      });
    }
  } else if (!normalizeTeam(lead.forwardedTeam)) {
    // No forceTeam supplied and lead has no team yet — mark routing as manual.
    await prisma.lead.update({ where: { id }, data: { routingMethod: "manual" } });
  }

  await assignLeadTo(id, userId, "manual assignment");

  // OperationLog — record the reversible single transfer so an admin can undo an
  // accidental reassignment (same op type / revert path as the bulk reassign).
  const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  const targetName = targetUser?.name || targetUser?.email || "user";
  await logOperation(prisma, {
    operation: "lead.transfer",
    entityType: "Lead",
    module: "Leads",
    summary: `Transfer → ${targetName}`,
    affectedIds: [id],
    beforeState: before,
    afterState: { toUserId: userId },
    createdById: me.id,
  }).catch(() => {});

  // Soft cross-team warning — re-read lead after potential forwardedTeam update.
  const updatedLead = await prisma.lead.findUnique({ where: { id }, select: { forwardedTeam: true } });
  const warning = crossTeamWarning(me.team, updatedLead?.forwardedTeam);

  if (warning) {
    return NextResponse.json({ ok: true, crossTeamWarning: warning });
  }
  return NextResponse.json({ ok: true });
}

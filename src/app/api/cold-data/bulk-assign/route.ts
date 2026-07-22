// Admin bulk-assigns unassigned cold-data rows to a specific agent.
// Picks the oldest N unassigned rows (optionally filtered by team).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { crossTeamWarning } from "@/lib/teamRouting";
import { LOST_STATUSES } from "@/lib/lead-statuses";

export async function POST(req: NextRequest) {
  // Bulk Assign is ADMIN / Super-Admin ONLY (Lalit): a MANAGER must NOT be able to
  // bulk-assign cold/revival rows. Super-admins carry role === "ADMIN", so
  // requireRole("ADMIN") includes them. Mirrors master-data/bulk's admin-only gate.
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "").trim();
  const team = body.team ? String(body.team) : undefined;
  const count = Math.max(1, Math.min(500, Number(body.count ?? 20)));

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Verify the target user exists, is active, and is a SALES user (never HR).
  // hrOnly excludes non-sales staff (e.g. Nisha) from cold-data assignment.
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || !target.active || target.hrOnly) return NextResponse.json({ error: "Target user not found or inactive" }, { status: 404 });

  // Pick N oldest unassigned cold-data rows
  const candidates = await prisma.lead.findMany({
    where: {
      isColdCall: true,
      ownerId: null,
      rejectedAt: null,        // never bulk-assign a rejected (hard-unassigned) cold lead
      ...(team ? { forwardedTeam: team } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: count,
    select: { id: true, forwardedTeam: true },
  });

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, assigned: 0, message: "No unassigned cold-data rows match the filter." });
  }

  const ids = candidates.map((c) => c.id);

  // Count cross-team warnings (soft — assignment still proceeds).
  let crossTeamCount = 0;
  for (const lead of candidates) {
    const w = crossTeamWarning(target.team, lead.forwardedTeam);
    if (w) crossTeamCount++;
  }

  // RC-2 fix (Lalit RCA 2026-07-21): this DIRECT updateMany bypasses the
  // assignLeadTo choke point (and therefore its LOST-reactivation), so a cold lead
  // that went terminal via a LOST status (rejectedAt still null, so it passed the
  // rejectedAt filter above) would end up owned AND lost. Assigning a cold row for
  // calling IS a reactivation, so reset the LOST subset to "Fresh Lead" first — the
  // same status the /reactivate route and assignLeadTo use. CLOSED/booked cold rows
  // (rare) keep their status.
  await prisma.lead.updateMany({
    where: { id: { in: ids }, currentStatus: { in: LOST_STATUSES } },
    data: { currentStatus: "Fresh Lead" },
  });
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    data: { ownerId: userId, assignedAt: new Date(), routingMethod: "manual" },
  });
  // Record an Assignment row per lead so the history page reflects this
  await prisma.assignment.createMany({
    data: ids.map((leadId) => ({ leadId, userId, reason: "Cold-data bulk assign" })),
  });
  await audit({
    userId: me.id, action: "cold.bulk-assign", entity: "Lead",
    meta: { assignedTo: userId, count: ids.length, crossTeamWarnings: crossTeamCount, leadIds: ids.slice(0, 50) },
    request: reqMeta(req),
  });
  return NextResponse.json({
    ok: true,
    assigned: ids.length,
    ...(crossTeamCount > 0 ? { crossTeamWarnings: crossTeamCount, crossTeamWarningMessage: `${crossTeamCount} lead${crossTeamCount === 1 ? "" : "s"} were assigned across teams. Please confirm this was intentional.` } : {}),
  });
}

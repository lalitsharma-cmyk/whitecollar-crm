// ADMIN-only: update a user's role and/or team.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

const VALID_ROLES = new Set(["ADMIN", "MANAGER", "AGENT"]);
const VALID_TEAMS = new Set(["Dubai", "India"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await requireRole("ADMIN");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: { role?: "ADMIN" | "MANAGER" | "AGENT"; team?: string | null } = {};

  if ("role" in body) {
    const role = String(body.role ?? "").trim();
    if (!VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "Role must be ADMIN, MANAGER, or AGENT" }, { status: 400 });
    }
    data.role = role as "ADMIN" | "MANAGER" | "AGENT";
  }

  if ("team" in body) {
    const team = body.team === null || body.team === "" ? null : String(body.team).trim();
    if (team !== null && !VALID_TEAMS.has(team)) {
      return NextResponse.json({ error: "Team must be Dubai or India" }, { status: 400 });
    }
    data.team = team;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, team: true, active: true },
  });

  // Role change → force re-login everywhere so the NEW permissions apply on a fresh
  // session (Lalit: "logout after role/permission change"). Team-only change doesn't revoke.
  let sessionsRevoked = 0;
  if (data.role) {
    const r = await prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "role_change" },
    });
    sessionsRevoked = r.count;
  }

  await audit({
    userId: me.id,
    action: "user.update",
    entity: "User",
    entityId: id,
    meta: { ...data, sessionsRevoked },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, user: updated, sessionsRevoked });
}

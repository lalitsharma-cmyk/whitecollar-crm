// ADMIN-only: toggle a user's active status (soft deactivate / reactivate).
// Admin cannot deactivate themselves.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await requireRole("ADMIN");
  const { id } = await params;

  if (id === me.id) {
    return NextResponse.json({ error: "You cannot deactivate your own account" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, active: true, isSuperAdmin: true, role: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Privilege-escalation guard — a non-super admin must not disable a super-admin
  // (or another admin) and lock the owner out.
  const denied = userManagementDenial(me, target);
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.code });

  const updated = await prisma.user.update({
    where: { id },
    data: { active: !target.active },
    select: { id: true, name: true, email: true, role: true, team: true, active: true },
  });

  // Disabling an account → kill all its sessions immediately so it loses access on
  // every device (Lalit: "logout after account disable"). Reactivating doesn't revoke.
  let sessionsRevoked = 0;
  if (!updated.active) {
    const r = await prisma.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "account_disabled" },
    });
    sessionsRevoked = r.count;
  }

  await audit({
    userId: me.id,
    action: updated.active ? "user.reactivate" : "user.deactivate",
    entity: "User",
    entityId: id,
    meta: { active: updated.active, sessionsRevoked },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, user: updated, sessionsRevoked });
}

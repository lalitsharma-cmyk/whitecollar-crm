// ADMIN-only: set a new password for any user without requiring the old password.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const me = await requireRole("ADMIN");

  const body = await req.json().catch(() => ({}));
  const newPassword = String(body.newPassword ?? "");
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isSuperAdmin: true, role: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  // Privilege-escalation guard — a non-super admin must not reset a super-admin's
  // (or another admin's) password and take over the account.
  const denied = userManagementDenial(me, target);
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.code });

  const hash = await bcrypt.hash(newPassword, 10);
  const now = new Date();
  // Stamp passwordChangedAt (getCurrentUser kills any session created before it) AND
  // bump sessionEpoch AND hard-revoke every active session → the user is logged out of
  // ALL devices immediately; the old password (and any saved-password autofill) cannot
  // start a new session either. Three layers so revocation is instant + durable.
  await prisma.user.update({
    where: { id: targetId },
    data: { passwordHash: hash, passwordChangedAt: now, sessionEpoch: { increment: 1 } },
  });
  const revoked = await prisma.userSession.updateMany({
    where: { userId: targetId, revokedAt: null },
    data: { revokedAt: now, revokedReason: "admin_password_reset" },
  });
  await audit({
    userId: me.id,
    action: "admin.password.reset",
    entity: "User",
    entityId: targetId,
    meta: { sessionsRevoked: revoked.count },
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true, sessionsRevoked: revoked.count });
}

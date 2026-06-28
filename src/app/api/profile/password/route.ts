// Logged-in user changes their own password. Verifies current password first.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const current = String(body.currentPassword ?? "");
  const next = String(body.newPassword ?? "");
  if (!current || !next) return NextResponse.json({ error: "Both passwords required" }, { status: 400 });
  if (next.length < 8) return NextResponse.json({ error: "New password must be at least 8 characters" }, { status: 400 });

  // Re-fetch hash (cached `me` may not include it)
  const u = await prisma.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const ok = await bcrypt.compare(current, u.passwordHash);
  if (!ok) {
    await audit({ userId: me.id, action: "auth.password.fail", entity: "User", entityId: me.id, request: reqMeta(req) });
    return NextResponse.json({ error: "Current password is wrong" }, { status: 401 });
  }
  const hash = await bcrypt.hash(next, 10);
  const now = new Date();
  // Same hardening as admin reset: stamp passwordChangedAt + bump sessionEpoch + revoke
  // ALL active sessions (incl. this one). The user re-logs-in with the new password on
  // every device; old saved passwords can't reopen access.
  await prisma.user.update({
    where: { id: me.id },
    data: { passwordHash: hash, passwordChangedAt: now, sessionEpoch: { increment: 1 } },
  });
  const revoked = await prisma.userSession.updateMany({
    where: { userId: me.id, revokedAt: null },
    data: { revokedAt: now, revokedReason: "self_password_change" },
  });
  await audit({ userId: me.id, action: "auth.password.change", entity: "User", entityId: me.id, meta: { sessionsRevoked: revoked.count }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, sessionsRevoked: revoked.count });
}

// ADMIN-only: set a new password for any user without requiring the old password.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
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

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: targetId }, data: { passwordHash: hash } });
  await audit({
    userId: me.id,
    action: "admin.password.reset",
    entity: "User",
    entityId: targetId,
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true });
}

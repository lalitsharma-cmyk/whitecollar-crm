// ADMIN-only: toggle a user's active status (soft deactivate / reactivate).
// Admin cannot deactivate themselves.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
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

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, active: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updated = await prisma.user.update({
    where: { id },
    data: { active: !target.active },
    select: { id: true, name: true, email: true, role: true, team: true, active: true },
  });

  await audit({
    userId: me.id,
    action: updated.active ? "user.reactivate" : "user.deactivate",
    entity: "User",
    entityId: id,
    meta: { active: updated.active },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, user: updated });
}

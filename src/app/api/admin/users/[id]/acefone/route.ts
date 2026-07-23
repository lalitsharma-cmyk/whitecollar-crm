// Admin-only: set or clear an agent's Acefone agent id (used for click-to-call routing).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN");
  const { id } = await params;
  // Privilege guard: a non-super admin cannot edit an admin/super-admin's Acefone id.
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, isSuperAdmin: true, role: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const denied = userManagementDenial(me, target);
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.code });
  const body = await req.json().catch(() => ({}));
  const raw = body.acefoneAgentId;
  const value = raw === null || raw === "" ? null : String(raw).trim().slice(0, 32) || null;
  await prisma.user.update({ where: { id }, data: { acefoneAgentId: value } });
  await audit({ userId: me.id, action: "user.acefone.set", entity: "User", entityId: id,
    meta: { acefoneAgentId: value }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, acefoneAgentId: value });
}

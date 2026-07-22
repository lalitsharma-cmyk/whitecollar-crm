// Admin → reactivate a former/suspended user. Admin-only, audited. A
// LEFT_ORGANIZATION user never regains access automatically — only this explicit
// call restores it (spec: reactivation is admin-only + creates a full audit trail).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import { reqMeta, audit } from "@/lib/audit";
import { reactivateUser } from "@/lib/offboarding";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN");
  const { id } = await params;
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, isSuperAdmin: true, role: true, employmentStatus: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const denied = userManagementDenial(me, target);
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.code });

  const result = await reactivateUser(id, me.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await audit({ userId: me.id, action: "user.reactivate.request", entity: "User", entityId: id, meta: { fromStatus: target.employmentStatus }, request: reqMeta(req) }).catch(() => {});
  return NextResponse.json({ ok: true, message: `${target.name} reactivated — access restored.` });
}

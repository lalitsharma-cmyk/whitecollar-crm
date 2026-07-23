// Admin-only: set/clear an agent's company WhatsApp number.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { toE164 } from "@/lib/phone";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN");
  const { id } = await params;
  // Privilege guard: a non-super admin cannot edit an admin/super-admin's WhatsApp number.
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, isSuperAdmin: true, role: true } });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const denied = userManagementDenial(me, target);
  if (denied) return NextResponse.json({ error: denied.message }, { status: denied.code });
  const body = await req.json().catch(() => ({}));
  const raw = body.companyWhatsAppNumber;
  // Normalise to E.164 so all WA links work
  const value = raw === null || raw === "" ? null : toE164(String(raw));
  await prisma.user.update({ where: { id }, data: { companyWhatsAppNumber: value } });
  await audit({ userId: me.id, action: "user.whatsapp-number.set", entity: "User", entityId: id,
    meta: { companyWhatsAppNumber: value }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, companyWhatsAppNumber: value });
}

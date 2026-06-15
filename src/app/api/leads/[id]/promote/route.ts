import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, leadOrigin: true, status: true } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lead.leadOrigin !== "COLD" && lead.leadOrigin !== "REVIVAL") return NextResponse.json({ error: "Already an active lead" }, { status: 400 });
  await prisma.lead.update({
    where: { id },
    data: {
      leadOrigin: "ACTIVE_LEAD",
      isColdCall: false,
      lastTouchedAt: new Date(),
    },
  });
  await audit({ userId: me.id, action: "lead.promote_from_cold", entity: "Lead", entityId: id, request: reqMeta(req) });
  return NextResponse.json({ ok: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

// Admin-only: wipe all leads + their children. Useful to retry imports cleanly.
export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const before = await prisma.lead.count();
  await prisma.activity.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.note.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.leadProperty.deleteMany({});
  await prisma.leadProject.deleteMany({});
  await prisma.whatsAppMessage.deleteMany({});
  const r = await prisma.lead.deleteMany({});
  await audit({ userId: me.id, action: "admin.wipe-leads", entity: "Lead",
    meta: { before, deleted: r.count }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, deletedLeads: r.count, before });
}

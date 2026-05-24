import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

// Admin-only: wipe all leads + their children. Useful to retry imports cleanly.
export async function POST() {
  await requireRole("ADMIN");
  const before = await prisma.lead.count();
  await prisma.activity.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.note.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.leadProperty.deleteMany({});
  await prisma.leadProject.deleteMany({});
  await prisma.whatsAppMessage.deleteMany({});
  const r = await prisma.lead.deleteMany({});
  return NextResponse.json({ ok: true, deletedLeads: r.count, before });
}

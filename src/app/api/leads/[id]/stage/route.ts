import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const newStatus = String(body.status ?? "");
  if (!(Object.values(LeadStatus) as string[]).includes(newStatus)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (lead.status === newStatus) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.lead.update({ where: { id }, data: { status: newStatus as LeadStatus, lastTouchedAt: new Date() } });
  await prisma.activity.create({
    data: {
      leadId: id, userId: me.id,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `Stage changed: ${lead.status.replaceAll("_", " ")} → ${newStatus.replaceAll("_", " ")}`,
      completedAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true });
}

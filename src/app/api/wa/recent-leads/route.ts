// Powers the WhatsApp side-panel — returns the 25 most-recently-touched leads
// that have a phone number, prioritising those with WhatsApp activity.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await requireUser();
  // Agents see only their leads; Admin/Manager see everything.
  const scope = me.role === "AGENT" ? { ownerId: me.id } : {};
  const leads = await prisma.lead.findMany({
    where: { ...scope, phone: { not: null } },
    orderBy: { lastTouchedAt: "desc" },
    take: 25,
    select: { id: true, name: true, phone: true, lastTouchedAt: true },
  });
  return NextResponse.json({
    leads: leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      lastTouched: l.lastTouchedAt ? timeAgo(l.lastTouchedAt) : null,
    })),
  });
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

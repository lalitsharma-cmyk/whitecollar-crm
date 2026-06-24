// Read share history (tracking display).
//   GET /api/resources/shares?leadId=...      → all resources shared with a lead
//                                                (caller must be able to touch it)
//   GET /api/resources/shares?resourceId=...  → all shares of a resource
//                                                (ADMIN/MANAGER — full history)
//   GET /api/resources/shares?mine=1          → the caller's own recent shares
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canTouchLead } from "@/lib/leadScope";
import { canManageResources } from "@/lib/resources";

export const dynamic = "force-dynamic";

const SHARE_SELECT = {
  id: true,
  channel: true,
  recipient: true,
  note: true,
  sharedAt: true,
  leadId: true,
  resourceId: true,
  sharedBy: { select: { id: true, name: true } },
  resource: { select: { id: true, title: true, type: true, category: true } },
  lead: { select: { id: true, name: true } },
} satisfies Prisma.ResourceShareSelect;

export async function GET(req: NextRequest) {
  const me = await requireUser();
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId")?.trim();
  const resourceId = url.searchParams.get("resourceId")?.trim();
  const mine = url.searchParams.get("mine") === "1";

  if (leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true, forwardedTeam: true } });
    if (!lead) return NextResponse.json({ items: [] });
    const allowed = await canTouchLead(me, { ownerId: lead.ownerId, forwardedTeam: lead.forwardedTeam });
    if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    const items = await prisma.resourceShare.findMany({
      where: { leadId },
      select: SHARE_SELECT,
      orderBy: { sharedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ items });
  }

  if (resourceId) {
    // Full per-resource history is a management view.
    if (!canManageResources(me.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    const items = await prisma.resourceShare.findMany({
      where: { resourceId },
      select: SHARE_SELECT,
      orderBy: { sharedAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ items });
  }

  // Default / ?mine=1 → the caller's own shares.
  const items = await prisma.resourceShare.findMany({
    where: { sharedById: me.id },
    select: SHARE_SELECT,
    orderBy: { sharedAt: "desc" },
    take: 100,
  });
  void mine;
  return NextResponse.json({ items });
}

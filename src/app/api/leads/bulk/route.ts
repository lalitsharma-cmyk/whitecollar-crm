import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No leads selected" }, { status: 400 });

  if (action === "reassign") {
    const userId = String(body.userId ?? "");
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    let done = 0;
    for (const id of ids) {
      try { await assignLeadTo(id, userId, "bulk reassign"); done++; }
      catch {}
    }
    await audit({ userId: me.id, action: "lead.bulk.reassign", entity: "Lead",
      meta: { count: done, toUserId: userId, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, reassigned: done });
  }
  if (action === "delete") {
    // Cascade delete via Prisma onDelete: Cascade on Lead-child relations
    const r = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
    await audit({ userId: me.id, action: "lead.bulk.delete", entity: "Lead",
      meta: { count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, deleted: r.count });
  }
  if (action === "change_stage") {
    const status = String(body.status ?? "");
    const r = await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: status as any } });
    await audit({ userId: me.id, action: "lead.bulk.stage", entity: "Lead",
      meta: { count: r.count, status, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: r.count });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

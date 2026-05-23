import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";

export async function POST(req: NextRequest) {
  await requireRole("ADMIN", "MANAGER");
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
    return NextResponse.json({ ok: true, reassigned: done });
  }
  if (action === "delete") {
    // Cascade delete via Prisma onDelete: Cascade on Lead-child relations
    const r = await prisma.lead.deleteMany({ where: { id: { in: ids } } });
    return NextResponse.json({ ok: true, deleted: r.count });
  }
  if (action === "change_stage") {
    const status = String(body.status ?? "");
    const r = await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { status: status as any } });
    return NextResponse.json({ ok: true, updated: r.count });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// Admin-only: set or clear a user's reporting manager.
// Guards against cycles (can't make X report to themselves directly or through chain).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const raw = body.managerId;
  const managerId: string | null = raw === null || raw === "" ? null : String(raw);

  if (managerId === id) {
    return NextResponse.json({ error: "Cannot report to yourself" }, { status: 400 });
  }

  // Cycle guard: walk up from the proposed manager — if we ever reach `id`, abort
  if (managerId) {
    const seen = new Set<string>();
    let cursor: string | null = managerId;
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (cursor === id) {
        return NextResponse.json({ error: "Cycle detected — proposed manager is one of this user's reports" }, { status: 400 });
      }
      const next: { managerId: string | null } | null = await prisma.user.findUnique({
        where: { id: cursor },
        select: { managerId: true },
      });
      cursor = next?.managerId ?? null;
    }
  }

  await prisma.user.update({ where: { id }, data: { managerId } });
  await audit({
    userId: me.id, action: "user.manager.set", entity: "User", entityId: id,
    meta: { managerId }, request: reqMeta(req),
  });
  return NextResponse.json({ ok: true });
}

// Update / delete a saved filter.
// Permission: only the creator or admin can mutate. System seeds (createdById=null)
// can only be deleted by admin.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const f = await prisma.savedFilter.findUnique({ where: { id } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (f.createdById !== me.id && me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim().slice(0, 80);
  if (typeof body.icon === "string") data.icon = body.icon.slice(0, 8);
  if (typeof body.isShared === "boolean") data.isShared = body.isShared;
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await prisma.savedFilter.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const f = await prisma.savedFilter.findUnique({ where: { id } });
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // System seeds (no creator) deletable only by admin. User filters deletable by owner or admin.
  if (f.createdById === null && me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admin can delete system filters" }, { status: 403 });
  }
  if (f.createdById !== null && f.createdById !== me.id && me.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await prisma.savedFilter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

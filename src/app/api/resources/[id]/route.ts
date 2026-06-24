// Update / soft-delete a single resource (ADMIN/MANAGER only).
//   PATCH  /api/resources/[id]  → edit metadata (title, category, project, tags,
//                                  fileUrl for URL, textContent for TEXT).
//   DELETE /api/resources/[id]  → soft-delete (sets deletedAt; reversible).
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { canManageResources } from "@/lib/resources";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageResources(me.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.resource.findUnique({ where: { id }, select: { id: true, type: true } });
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const data: Prisma.ResourceUpdateInput = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim();
  if (typeof body.category === "string" && body.category.trim()) data.category = body.category.trim();
  if ("projectName" in body) data.projectName = String(body.projectName ?? "").trim() || null;
  if ("tags" in body) data.tags = String(body.tags ?? "").trim() || null;
  // Type-specific payload fields.
  if (existing.type === "URL" && typeof body.fileUrl === "string") {
    const u = body.fileUrl.trim();
    if (!/^https?:\/\//i.test(u)) return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
    data.fileUrl = u;
  }
  if (existing.type === "TEXT" && typeof body.textContent === "string") {
    const t = body.textContent.trim();
    if (!t) return NextResponse.json({ error: "Template text cannot be empty" }, { status: 400 });
    data.textContent = t;
  }
  // Allow restore from recycle.
  if (body.restore === true) data.deletedAt = null;

  const updated = await prisma.resource.update({
    where: { id },
    data,
    select: { id: true, title: true, category: true, type: true, projectName: true, tags: true, deletedAt: true },
  });
  return NextResponse.json({ resource: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageResources(me.role)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await prisma.resource.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Resource not found" }, { status: 404 });

  // Soft-delete — reversible (PATCH { restore: true } brings it back).
  await prisma.resource.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

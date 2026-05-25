// Update / delete a single template (admin / manager only).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { TemplateKind, TemplateTrigger } from "@prisma/client";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (typeof body.body === "string") data.body = body.body.trim();
  if (body.subject != null) data.subject = body.subject ? String(body.subject).trim() : null;
  if (typeof body.kind === "string" && (Object.values(TemplateKind) as string[]).includes(body.kind)) data.kind = body.kind;
  if (typeof body.trigger === "string" && (Object.values(TemplateTrigger) as string[]).includes(body.trigger)) data.trigger = body.trigger;
  if (typeof body.active === "boolean") data.active = body.active;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await prisma.template.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  await prisma.template.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

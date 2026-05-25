// Create + list templates (admin / manager only).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { TemplateKind, TemplateTrigger } from "@prisma/client";

export async function GET() {
  await requireRole("ADMIN", "MANAGER");
  const items = await prisma.template.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  const trigger = String(body.trigger ?? "GENERIC");
  const name = String(body.name ?? "").trim();
  const subject = body.subject ? String(body.subject).trim() : null;
  const text = String(body.body ?? "").trim();
  if (!name || !text) return NextResponse.json({ error: "name + body required" }, { status: 400 });
  if (!(Object.values(TemplateKind) as string[]).includes(kind)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  if (!(Object.values(TemplateTrigger) as string[]).includes(trigger)) return NextResponse.json({ error: "Invalid trigger" }, { status: 400 });
  const t = await prisma.template.create({
    data: { kind: kind as TemplateKind, trigger: trigger as TemplateTrigger, name, subject, body: text, createdById: me.id },
  });
  return NextResponse.json({ ok: true, id: t.id });
}

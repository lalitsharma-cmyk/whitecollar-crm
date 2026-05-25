// Returns all active templates of a given kind, with placeholders pre-rendered
// against a specific lead's data. Used by TemplatePickerButton on lead detail.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { TemplateKind } from "@prisma/client";
import { renderTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await requireUser();
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId") ?? "";
  const kindRaw = url.searchParams.get("kind") ?? "WHATSAPP";
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
  if (!(Object.values(TemplateKind) as string[]).includes(kindRaw)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const kind = kindRaw as TemplateKind;

  const [lead, templates] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 },
      },
    }),
    prisma.template.findMany({ where: { kind, active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const project = lead.interestedUnits[0]?.unit.project ?? null;
  const ctx = { lead, agent: me, project };
  const items = templates.map(t => ({
    id: t.id,
    kind: t.kind,
    trigger: t.trigger,
    name: t.name,
    subject: t.subject,
    body: t.body,
    rendered: {
      body: renderTemplate(t.body, ctx),
      subject: t.subject ? renderTemplate(t.subject, ctx) : null,
    },
  }));
  return NextResponse.json({ items });
}

// Renders a single template against a given lead so admins can preview the
// substitution output from /admin/templates without leaving the page.
// Also returns which `{{tokens}}` ended up empty so the admin knows what data
// is missing on the lead.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { renderTemplate } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const url = new URL(req.url);
  const templateId = url.searchParams.get("templateId") ?? "";
  const leadId = url.searchParams.get("leadId") ?? "";
  if (!templateId) return NextResponse.json({ ok: false, error: "templateId required" }, { status: 400 });
  if (!leadId) return NextResponse.json({ ok: false, error: "leadId required" }, { status: 400 });

  const [template, lead] = await Promise.all([
    prisma.template.findUnique({ where: { id: templateId } }),
    prisma.lead.findUnique({
      where: { id: leadId },
      include: { interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
  ]);
  if (!template) return NextResponse.json({ ok: false, error: "Template not found" }, { status: 404 });
  if (!lead) return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });

  const project = lead.interestedUnits[0]?.unit.project ?? null;
  const ctx = { lead, agent: me, project };

  const renderedBody = renderTemplate(template.body, ctx);
  const renderedSubject = template.subject ? renderTemplate(template.subject, ctx) : null;

  // Detect which placeholders rendered to an empty string — flags missing data.
  const tokens = new Set<string>();
  const tokenRe = /\{\{\s*(\w+)\s*\}\}/g;
  for (const src of [template.body, template.subject ?? ""]) {
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(src)) !== null) tokens.add(m[1].toLowerCase());
  }
  const missingFields: string[] = [];
  for (const tok of tokens) {
    // Re-render a probe of just this token; if it returns empty, the value is missing.
    const probe = renderTemplate(`{{${tok}}}`, ctx);
    if (!probe) missingFields.push(tok);
  }

  return NextResponse.json({
    ok: true,
    rendered: { body: renderedBody, subject: renderedSubject },
    missingFields,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HR template RENDER — returns active templates of a kind with {{placeholders}}
// pre-substituted against a specific CANDIDATE's data.
//
// Mirrors the Sales render endpoint (/api/templates/render) response shape so the
// candidate detail UI can reuse the same picker flow, but:
//   • auth goes through loadOwnedCandidate() (404 on out-of-scope, never 403), and
//   • the TemplateContext is built from HRCandidate fields instead of Lead fields.
//
// Field mapping (Lead-shaped context expected by renderTemplate):
//   {{name}}/{{fullname}}  ← candidate.name
//   {{agent}}/{{agent_full}}/{{agent_wa}} ← current HR user (me)
//   {{phone}}              ← candidate.phone
//   {{email}}             ← candidate.email
//   {{budget}}            ← candidate.expectedSalary (formatted via salaryCurrency)
//   {{project}}          ← candidate.positionApplied  (the role they applied for)
//   {{city}}             ← candidate.city
//
// Response: { items: [{ id, kind, trigger, name, subject?, body, rendered:{body,subject?} }] }
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedCandidate } from "@/lib/hrAccess";
import { TemplateKind } from "@prisma/client";
import { renderTemplate, type TemplateContext } from "@/lib/templates";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId") ?? "";
  const kindRaw = url.searchParams.get("kind") ?? "WHATSAPP";

  if (!candidateId) return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  if (!(Object.values(TemplateKind) as string[]).includes(kindRaw)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const kind = kindRaw as TemplateKind;

  // Scope + ownership guard. 404 (not 403) on out-of-scope candidates.
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const { me } = access;

  // loadOwnedCandidate returns a slim projection; fetch the extra fields the
  // template context needs (name/phone are already known but re-read for clarity).
  const [candidate, templates] = await Promise.all([
    prisma.hRCandidate.findFirst({
      where: { id: candidateId, deletedAt: null },
      select: {
        name: true, phone: true, email: true,
        expectedSalary: true, salaryCurrency: true,
        positionApplied: true, city: true,
      },
    }),
    prisma.template.findMany({ where: { kind, active: true }, orderBy: { name: "asc" } }),
  ]);
  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Build a Lead-shaped TemplateContext from candidate fields so the existing
  // renderTemplate() (single source of substitution truth) works unchanged.
  const ctx: TemplateContext = {
    lead: {
      name: candidate.name,
      phone: candidate.phone,
      email: candidate.email,
      budgetMin: candidate.expectedSalary ?? null,
      budgetCurrency: candidate.salaryCurrency ?? "AED",
    },
    agent: {
      name: me.name,
      email: me.email,
      companyWhatsAppNumber: me.companyWhatsAppNumber ?? null,
    },
    // {{project}} → role applied for, {{city}} → candidate city.
    project: candidate.positionApplied
      ? { name: candidate.positionApplied, city: candidate.city ?? "" }
      : (candidate.city ? { name: "", city: candidate.city } : null),
  };

  const items = templates.map((t) => ({
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

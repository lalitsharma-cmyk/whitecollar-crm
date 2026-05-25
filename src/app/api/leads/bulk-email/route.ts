// Bulk-email a list of leads using a saved Email template.
// Posts: { ids: string[], templateId: string }
//
// For each lead: substitutes placeholders, sends via Resend, logs to AuditLog.
// Throttles to 8 concurrent sends to stay under Resend rate limits.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { renderTemplate } from "@/lib/templates";
import { audit, reqMeta } from "@/lib/audit";
import { ActivityType, ActivityStatus } from "@prisma/client";

const RESEND_API = "https://api.resend.com/emails";
const CONCURRENCY = 8;

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  const templateId = String(body.templateId ?? "");
  if (ids.length === 0) return NextResponse.json({ error: "No leads selected" }, { status: 400 });
  if (!templateId) return NextResponse.json({ error: "templateId required" }, { status: 400 });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const RESEND_FROM = process.env.RESEND_FROM ?? `WCR CRM <noreply@crm.whitecollarrealty.com>`;
  if (!RESEND_KEY) return NextResponse.json({ error: "Resend not configured — set RESEND_API_KEY in Vercel env" }, { status: 503 });

  const [template, leads] = await Promise.all([
    prisma.template.findUnique({ where: { id: templateId } }),
    prisma.lead.findMany({
      where: { id: { in: ids } },
      include: { interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
  ]);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (template.kind !== "EMAIL") return NextResponse.json({ error: "Template is not an EMAIL template" }, { status: 400 });

  // Pin the non-null template — TS can't follow narrowing through the inner closure.
  const tpl = template;
  const eligible = leads.filter(l => l.email);
  const skipped = leads.length - eligible.length;

  let sent = 0;
  const errors: string[] = [];

  // Concurrency-limited send pool
  async function sendOne(lead: typeof eligible[number]) {
    const project = lead.interestedUnits[0]?.unit.project ?? null;
    const ctx = { lead, agent: me, project };
    const subject = tpl.subject ? renderTemplate(tpl.subject, ctx) : "Following up";
    const text = renderTemplate(tpl.body, ctx);
    try {
      const r = await fetch(RESEND_API, {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [lead.email!],
          subject,
          text,
        }),
      });
      if (!r.ok) {
        const j = await r.text().catch(() => "");
        errors.push(`${lead.email} → ${r.status} ${j.slice(0, 80)}`);
        return;
      }
      sent++;
      // Log a per-lead activity so the agent can see what was sent
      await prisma.activity.create({
        data: {
          leadId: lead.id, userId: me.id,
          type: ActivityType.EMAIL,
          status: ActivityStatus.DONE,
          title: `📧 Bulk email: ${tpl.name}`,
          description: `Subject: ${subject}\n\n${text.slice(0, 500)}${text.length > 500 ? "…" : ""}`,
          completedAt: new Date(),
        },
      });
    } catch (e) {
      errors.push(`${lead.email} → ${String(e).slice(0, 80)}`);
    }
  }

  // Pool runner
  const queue = [...eligible];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const l = queue.shift();
      if (l) await sendOne(l);
    }
  }));

  await audit({
    userId: me.id,
    action: "lead.bulk.email",
    entity: "Lead",
    meta: { templateId, templateName: template.name, sent, skipped, errorCount: errors.length, leadIds: ids.slice(0, 50) },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, sent, skipped, errors: errors.slice(0, 10), total: leads.length });
}

// Speed-to-lead — auto WhatsApp + email a brand-new lead within seconds of intake.
//
// Hook: called fire-and-forget from `leadIngest.ts` after a new (non-duplicate)
// lead is created. Never throws — all errors swallowed so intake stays fast.
//
// What it does:
//   1. Loads the lead + its first interested project + the owner (or fallback admin)
//   2. Picks the first active FIRST_QUERY templates (one WA, one EMAIL)
//   3. Renders placeholders against (lead, agent, project)
//   4. Sends WA via Meta Cloud API (or STUB if not configured — still logs)
//   5. Sends Email via Resend (skips if no email or no key)
//   6. Logs an Activity "🚀 Speed-to-lead auto-response" on the timeline
//   7. Bumps lead.lastTouchedAt
//
// Admin kill-switch: Setting key `speedToLead.enabled` (default "true").
// If the overnight after-hours WA welcome already fired (template name match),
// we skip the duplicate WA send.

import { prisma } from "@/lib/prisma";
import {
  ActivityType,
  ActivityStatus,
  TemplateKind,
  TemplateTrigger,
  WAMessageDirection,
} from "@prisma/client";
import { renderTemplate, type TemplateContext } from "@/lib/templates";
import { whatsappEnabled } from "@/lib/whatsappOutbound";
import { currentWindow } from "@/lib/assignmentWindow";
import { audit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";

const FROM_NUMBER = "8810286629"; // company main WA display number (informational)
const META_BASE = "https://graph.facebook.com/v21.0";

/**
 * Fire-and-forget speed-to-lead auto-response.
 * Returns a summary but is designed to be `.catch(() => {})`'d by callers.
 */
export async function sendSpeedToLeadResponses(leadId: string): Promise<{
  ok: boolean;
  waSent: boolean;
  emailSent: boolean;
  skipped?: string;
}> {
  // 1. Admin kill-switch
  const enabledRaw = await getSetting("speedToLead.enabled");
  const enabled = enabledRaw === "" ? true : enabledRaw.toLowerCase() !== "false";
  if (!enabled) {
    return { ok: true, waSent: false, emailSent: false, skipped: "disabled by admin" };
  }

  // 2. Load lead with first interested project + owner
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      owner: true,
      interestedUnits: {
        include: { unit: { include: { project: true } } },
        take: 1,
      },
    },
  });
  if (!lead) return { ok: false, waSent: false, emailSent: false, skipped: "lead not found" };

  // 3. Resolve "agent" for template rendering — lead owner, else any active admin
  let agent = lead.owner;
  if (!agent) {
    agent = await prisma.user.findFirst({
      where: { role: "ADMIN", active: true },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!agent) {
    return { ok: false, waSent: false, emailSent: false, skipped: "no agent or admin to render template" };
  }

  const project = lead.interestedUnits[0]?.unit.project ?? null;
  const ctx: TemplateContext = { lead, agent, project };

  // 4. Pick first active FIRST_QUERY templates (one of each kind)
  const [waTpl, emailTpl] = await Promise.all([
    prisma.template.findFirst({
      where: { kind: TemplateKind.WHATSAPP, trigger: TemplateTrigger.FIRST_QUERY, active: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.template.findFirst({
      where: { kind: TemplateKind.EMAIL, trigger: TemplateTrigger.FIRST_QUERY, active: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  let waSent = false;
  let emailSent = false;

  // 5. WhatsApp send — skip if we're in the OVERNIGHT_QUEUE window (the
  //    dedicated after-hours welcome already handles that case) or if any
  //    outbound WA was already logged for this lead in the last 30 min.
  if (waTpl && lead.phone) {
    const window = currentWindow();
    const recentAutoWA = await prisma.whatsAppMessage.findFirst({
      where: {
        leadId: lead.id,
        direction: WAMessageDirection.OUTBOUND,
        receivedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      },
    });
    if (window.kind === "OVERNIGHT_QUEUE" || recentAutoWA) {
      await audit({
        action: "speedToLead.wa.skip",
        entity: "Lead",
        entityId: lead.id,
        meta: {
          reason: window.kind === "OVERNIGHT_QUEUE"
            ? "overnight window — after-hours welcome handles this slot"
            : "recent outbound WA already logged",
        },
      });
    } else {
      waSent = await sendSpeedWhatsApp(lead.id, lead.phone, lead.name, renderTemplate(waTpl.body, ctx), waTpl.id, waTpl.name);
    }
  }

  // 6. Email send — Resend
  if (emailTpl && lead.email) {
    emailSent = await sendSpeedEmail(
      lead.id,
      lead.email,
      emailTpl.subject ? renderTemplate(emailTpl.subject, ctx) : `Welcome to White Collar Realty`,
      renderTemplate(emailTpl.body, ctx),
      emailTpl.name,
    );
  }

  // 7. Activity timeline entry — only if we actually sent something
  if (waSent || emailSent) {
    const channels: string[] = [];
    if (waSent) channels.push("WhatsApp");
    if (emailSent) channels.push("Email");
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: agent.id,
        type: waSent ? ActivityType.WHATSAPP : ActivityType.EMAIL,
        status: ActivityStatus.DONE,
        title: `🚀 Speed-to-lead auto-response (${channels.join(" + ")})`,
        description: `Auto-sent within seconds of lead intake. Templates: ${[waTpl?.name, emailTpl?.name].filter(Boolean).join(" / ")}`,
        completedAt: new Date(),
      },
    });

    // 8. Bump lastTouchedAt
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastTouchedAt: new Date() },
    });
  }

  await audit({
    action: "speedToLead.fired",
    entity: "Lead",
    entityId: lead.id,
    meta: { waSent, emailSent, waTpl: waTpl?.name, emailTpl: emailTpl?.name },
  });

  return { ok: true, waSent, emailSent };
}

// ── WhatsApp sender (extends the whatsappOutbound pattern: real / stub) ──
async function sendSpeedWhatsApp(
  leadId: string,
  phone: string,
  leadName: string,
  renderedBody: string,
  templateId: string,
  templateName: string,
): Promise<boolean> {
  const cleanPhone = phone.replace(/[^\d]/g, "");
  if (!cleanPhone) return false;

  // ── STUB mode: still log so the timeline shows what we'd have sent ──
  if (!whatsappEnabled()) {
    await prisma.whatsAppMessage.create({
      data: {
        leadId,
        phoneNumber: cleanPhone,
        direction: WAMessageDirection.OUTBOUND,
        body: `[STUB — would have sent from ${FROM_NUMBER}] ${renderedBody}`,
        templateId,
        providerMsgId: `stub-stl-${Date.now()}`,
      },
    });
    await audit({
      action: "speedToLead.wa.stub",
      entity: "Lead",
      entityId: leadId,
      meta: { to: cleanPhone, template: templateName, reason: "WA_BUSINESS_TOKEN not set" },
    });
    return true;
  }

  // ── REAL Meta Cloud API send ──
  const phoneNumberId = process.env.WA_BUSINESS_PHONE_NUMBER_ID!;
  const token = process.env.WA_BUSINESS_TOKEN!;
  // For Meta we still need an approved template name — env override, else fall back
  // to the after-hours template since it's the same audience (brand new lead).
  const metaTemplateName = process.env.WA_FIRST_QUERY_TEMPLATE
    ?? process.env.WA_AFTERHOURS_TEMPLATE
    ?? "afterhours_welcome";
  try {
    const r = await fetch(`${META_BASE}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "template",
        template: {
          name: metaTemplateName,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: leadName.split(" ")[0] }] },
          ],
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    const providerMsgId = j?.messages?.[0]?.id ?? `meta-stl-${Date.now()}`;
    if (!r.ok) {
      await audit({
        action: "speedToLead.wa.fail",
        entity: "Lead",
        entityId: leadId,
        meta: { status: r.status, response: j },
      });
      return false;
    }
    await prisma.whatsAppMessage.create({
      data: {
        leadId,
        phoneNumber: cleanPhone,
        direction: WAMessageDirection.OUTBOUND,
        body: `[Speed-to-lead · ${templateName}] ${renderedBody}`,
        templateId,
        providerMsgId,
      },
    });
    await audit({
      action: "speedToLead.wa.sent",
      entity: "Lead",
      entityId: leadId,
      meta: { to: cleanPhone, providerMsgId, template: templateName },
    });
    return true;
  } catch (e) {
    await audit({
      action: "speedToLead.wa.error",
      entity: "Lead",
      entityId: leadId,
      meta: { error: String(e).slice(0, 200) },
    });
    return false;
  }
}

// ── Email sender (Resend, matching bulk-email pattern) ──
async function sendSpeedEmail(
  leadId: string,
  to: string,
  subject: string,
  text: string,
  templateName: string,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "WCR CRM <noreply@crm.whitecollarrealty.com>";
  if (!apiKey) {
    await audit({
      action: "speedToLead.email.skip",
      entity: "Lead",
      entityId: leadId,
      meta: { reason: "RESEND_API_KEY not configured" },
    });
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      await audit({
        action: "speedToLead.email.fail",
        entity: "Lead",
        entityId: leadId,
        meta: { status: r.status, body: body.slice(0, 200), template: templateName },
      });
      return false;
    }
    await audit({
      action: "speedToLead.email.sent",
      entity: "Lead",
      entityId: leadId,
      meta: { to, template: templateName, subject },
    });
    return true;
  } catch (e) {
    await audit({
      action: "speedToLead.email.error",
      entity: "Lead",
      entityId: leadId,
      meta: { error: String(e).slice(0, 200) },
    });
    return false;
  }
}

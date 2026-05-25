// Outbound WhatsApp sender — pluggable provider.
//
// Currently in STUB mode by default: logs the intended message to AuditLog +
// creates a WhatsAppMessage row marked direction=OUTBOUND so it shows in the
// timeline, but doesn't actually send.
//
// To enable real send via Meta Cloud API:
//   1. Set WA_BUSINESS_TOKEN (Meta access token)
//   2. Set WA_BUSINESS_PHONE_NUMBER_ID (phone-number ID, NOT the number)
//      — defaults to WCR's main 8810286629 once registered with Meta
//   3. Submit a "utility / authentication" template to Meta for approval
//      (afterhours_welcome). Template name goes in WA_AFTERHOURS_TEMPLATE
//
// We use a TEMPLATE because the 24-hour rule blocks free-form outbound to
// people who haven't messaged us recently. Welcoming a brand-new lead at
// 2am necessarily means we have no prior message → template only.

import { prisma } from "@/lib/prisma";
import { WAMessageDirection } from "@prisma/client";
import { audit } from "@/lib/audit";

const FROM_NUMBER = "8810286629";              // company main WA number (display)
const META_BASE = "https://graph.facebook.com/v21.0";

export interface SendResult {
  ok: boolean;
  mode: "real" | "stub";
  providerMsgId?: string;
  error?: string;
}

export function whatsappEnabled(): boolean {
  return !!(process.env.WA_BUSINESS_TOKEN && process.env.WA_BUSINESS_PHONE_NUMBER_ID);
}

/**
 * Sends the "after-hours welcome" template to a new lead's phone.
 * Returns success even in stub mode (so the caller pipeline doesn't break).
 */
export async function sendAfterHoursWelcome(leadId: string, leadPhone: string, leadName: string): Promise<SendResult> {
  const cleanPhone = leadPhone.replace(/[^\d]/g, "");
  if (!cleanPhone) return { ok: false, mode: "stub", error: "no phone" };

  // ── STUB mode (default until Meta paperwork done) ──
  if (!whatsappEnabled()) {
    const message = `Hi ${leadName.split(" ")[0]}, this is White Collar Realty. Thank you for reaching out — our team will respond at 10am IST. For urgent help reply YES and we'll call first thing.`;
    await prisma.whatsAppMessage.create({
      data: {
        leadId,
        phoneNumber: cleanPhone,
        direction: WAMessageDirection.OUTBOUND,
        body: `[STUB — would have sent from ${FROM_NUMBER}] ${message}`,
        providerMsgId: `stub-${Date.now()}`,
      },
    });
    await audit({
      action: "whatsapp.afterhours.stub",
      entity: "Lead", entityId: leadId,
      meta: { to: cleanPhone, message, reason: "WA_BUSINESS_TOKEN not set" },
    });
    return { ok: true, mode: "stub" };
  }

  // ── REAL Meta Cloud API send ──
  const phoneNumberId = process.env.WA_BUSINESS_PHONE_NUMBER_ID!;
  const token = process.env.WA_BUSINESS_TOKEN!;
  const templateName = process.env.WA_AFTERHOURS_TEMPLATE ?? "afterhours_welcome";
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
          name: templateName,
          language: { code: "en" },
          components: [
            { type: "body", parameters: [{ type: "text", text: leadName.split(" ")[0] }] },
          ],
        },
      }),
    });
    const j = await r.json().catch(() => ({}));
    const id = j?.messages?.[0]?.id ?? null;
    if (!r.ok) {
      await audit({ action: "whatsapp.afterhours.fail", entity: "Lead", entityId: leadId, meta: { status: r.status, response: j } });
      return { ok: false, mode: "real", error: `Meta ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    }
    await prisma.whatsAppMessage.create({
      data: {
        leadId,
        phoneNumber: cleanPhone,
        direction: WAMessageDirection.OUTBOUND,
        body: `[Auto after-hours welcome template]`,
        providerMsgId: id ?? `meta-${Date.now()}`,
      },
    });
    await audit({ action: "whatsapp.afterhours.sent", entity: "Lead", entityId: leadId, meta: { to: cleanPhone, providerMsgId: id } });
    return { ok: true, mode: "real", providerMsgId: id ?? undefined };
  } catch (e) {
    return { ok: false, mode: "real", error: String(e).slice(0, 200) };
  }
}

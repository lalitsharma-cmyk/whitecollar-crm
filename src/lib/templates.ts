// Template rendering — replaces {{placeholder}} tokens with lead/agent data.
// Used by the WA/email picker on lead detail AND by the bulk-email action.

import type { Lead, User, Project } from "@prisma/client";
import { fmtMoney } from "@/lib/money";

export interface TemplateContext {
  lead: Pick<Lead, "name" | "phone" | "email" | "budgetMin" | "budgetCurrency">;
  agent: Pick<User, "name" | "email" | "companyWhatsAppNumber">;
  /** First interested project — optional, omitted if empty. */
  project?: Pick<Project, "name" | "city"> | null;
}

/** Replaces every `{{key}}` in `body` with its value from `ctx`. Missing values → empty string. */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const firstName = ctx.lead.name.split(/\s+/)[0] ?? ctx.lead.name;
  const agentFirst = ctx.agent.name.split(/\s+/)[0] ?? ctx.agent.name;
  const budget = ctx.lead.budgetMin ? fmtMoney(ctx.lead.budgetMin, ctx.lead.budgetCurrency ?? "AED") : "";
  const vars: Record<string, string> = {
    name: firstName,
    fullname: ctx.lead.name,
    agent: agentFirst,
    agent_full: ctx.agent.name,
    agent_wa: ctx.agent.companyWhatsAppNumber ?? "",
    project: ctx.project?.name ?? "",
    city: ctx.project?.city ?? "",
    budget,
    phone: ctx.lead.phone ?? "",
    email: ctx.lead.email ?? "",
  };
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k.toLowerCase()] ?? "");
}

/** Returns a human-readable label for a trigger (used in picker dropdowns). */
export function triggerLabel(t: string): string {
  switch (t) {
    case "FIRST_QUERY":      return "🆕 First query";
    case "AFTER_CALL":       return "📞 After a call";
    case "AFTER_NOT_PICKED": return "📵 After not picked";
    case "SCHEDULE_VISIT":   return "📅 Schedule visit";
    case "POST_VISIT":       return "🚗 After site visit";
    case "NEGOTIATION":      return "🤝 Negotiating";
    case "REENGAGE_COLD":    return "🧊 Re-engage cold";
    case "GENERIC":          return "🔧 Generic";
    default: return t;
  }
}

/** Pre-seeded starter templates — admin can edit/replace via /admin/templates. */
export const SEED_TEMPLATES = [
  // ── WhatsApp ────────────────────────────────────────────
  { kind: "WHATSAPP", trigger: "FIRST_QUERY", name: "First-query welcome (WA)",
    body: "Hi {{name}}, this is {{agent}} from White Collar Realty. Thank you for your enquiry. I'll be your dedicated property advisor — may I know a convenient time to call you today?" },
  { kind: "WHATSAPP", trigger: "AFTER_CALL", name: "Post-call summary (WA)",
    body: "Hi {{name}}, thanks for the chat just now. As discussed, I'm sharing the details of {{project}}. Let me know if you'd like me to schedule a site visit." },
  { kind: "WHATSAPP", trigger: "AFTER_NOT_PICKED", name: "Missed-call follow-up (WA)",
    body: "Hi {{name}}, I tried reaching you regarding your property enquiry. Please let me know a good time to call back — happy to share options that match your {{budget}} budget." },
  { kind: "WHATSAPP", trigger: "SCHEDULE_VISIT", name: "Site-visit invite (WA)",
    body: "Hi {{name}}, would you be available this weekend for a site visit at {{project}}? I can arrange a slot and pick-up if needed." },
  { kind: "WHATSAPP", trigger: "POST_VISIT", name: "Post-visit thank you (WA)",
    body: "Hi {{name}}, thank you for visiting {{project}} today. Hope you got a clear picture — let me know any questions about pricing, payment plan, or any unit you'd like to revisit." },
  { kind: "WHATSAPP", trigger: "NEGOTIATION", name: "Negotiation nudge (WA)",
    body: "Hi {{name}}, following up on our last conversation about {{project}}. I've spoken with the developer and have an update for you — when can we hop on a quick call?" },
  { kind: "WHATSAPP", trigger: "REENGAGE_COLD", name: "Re-engage dormant lead (WA)",
    body: "Hi {{name}}, hope you've been well. Just checking in — are you still exploring property options? A few new launches in your range have come up." },
  { kind: "WHATSAPP", trigger: "GENERIC", name: "Generic check-in (WA)",
    body: "Hi {{name}}, this is {{agent}} from White Collar Realty. Any update on your property search? Happy to help with any questions." },

  // ── Email ────────────────────────────────────────────────
  { kind: "EMAIL", trigger: "FIRST_QUERY", name: "Welcome email",
    subject: "Welcome to White Collar Realty, {{name}}",
    body: "Hi {{name}},\n\nThank you for reaching out to White Collar Realty. I'm {{agent}}, your dedicated property advisor.\n\nI'd love to learn more about what you're looking for so I can match you with the right options. Please let me know a convenient time for a quick call.\n\nBest regards,\n{{agent_full}}\nWhite Collar Realty\n{{agent_wa}}" },
  { kind: "EMAIL", trigger: "AFTER_CALL", name: "Post-call recap with brochure",
    subject: "{{project}} — details we discussed",
    body: "Hi {{name}},\n\nThank you for taking the time to speak with me today. As promised, please find attached the details of {{project}}.\n\nKey highlights from our chat:\n• Configuration: \n• Budget range: {{budget}}\n• Timeline: \n\nLet me know if you'd like to schedule a site visit or if any other questions come up.\n\n{{agent_full}}\nWhite Collar Realty" },
  { kind: "EMAIL", trigger: "AFTER_NOT_PICKED", name: "Tried-to-reach email",
    subject: "Tried reaching you, {{name}}",
    body: "Hi {{name}},\n\nI've been trying to reach you regarding the property options you enquired about. I have some options in mind that match your {{budget}} budget — would love to share them.\n\nWhat would be the best time to connect this week?\n\n{{agent_full}}" },
  { kind: "EMAIL", trigger: "SCHEDULE_VISIT", name: "Site-visit slot invite",
    subject: "Site visit at {{project}} — pick a slot",
    body: "Hi {{name}},\n\nI'd like to invite you for a site visit at {{project}}, {{city}}. Below are a few slot options:\n\n• Saturday morning\n• Sunday afternoon\n• Other (please share your preference)\n\nWe can arrange cab pickup if you'd like.\n\n{{agent_full}}" },
  { kind: "EMAIL", trigger: "POST_VISIT", name: "Post-visit thank you",
    subject: "Thank you for visiting {{project}}",
    body: "Hi {{name}},\n\nThank you for visiting us at {{project}} today. I hope the site walk gave you a clearer picture.\n\nIf any questions come up regarding pricing, payment plan, or specific units, please don't hesitate to reach out.\n\nLet me know if you'd like a comparison with other projects too.\n\n{{agent_full}}" },
  { kind: "EMAIL", trigger: "NEGOTIATION", name: "Negotiation update",
    subject: "Update on {{project}}",
    body: "Hi {{name}},\n\nFollowing up on our discussion about {{project}}. I've spoken with the developer and have an update for you — when's a good time for a quick call?\n\n{{agent_full}}" },
  { kind: "EMAIL", trigger: "REENGAGE_COLD", name: "Re-engagement email",
    subject: "Any update on your property search?",
    body: "Hi {{name}},\n\nHope you've been well. Just a quick note — a few new launches in your range have come up recently. Would you like me to share details?\n\nNo pressure, just thought you'd like to know.\n\n{{agent_full}}\nWhite Collar Realty" },
  { kind: "EMAIL", trigger: "GENERIC", name: "Generic follow-up",
    subject: "Following up — White Collar Realty",
    body: "Hi {{name}},\n\nJust following up on your property enquiry. Happy to help with any questions you may have.\n\n{{agent_full}}\nWhite Collar Realty" },
] as const;

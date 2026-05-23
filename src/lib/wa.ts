// FREE WhatsApp "draft" links — opens WhatsApp with message pre-typed,
// agent just taps Send. No WhatsApp Business API needed.

export function waDraftLink(phone: string, message: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// Common templates — agents can tap these one-tap from notifications
export const WA_TEMPLATES = {
  newLeadGreetingEN: (leadName: string, agentName: string) =>
    `Hi ${leadName}, this is ${agentName} from White Collar Realty. I'll be your dedicated property advisor. May I know a convenient time to call you today?`,
  newLeadGreetingHI: (leadName: string, agentName: string) =>
    `Namaste ${leadName} ji, main ${agentName} from White Collar Realty hoon. Aapki property requirement ke liye main aapko assist karunga. Aapse baat karne ka best time kya hai?`,
  followupEN: (leadName: string) =>
    `Hi ${leadName}, just a quick follow-up — would you like to schedule a site visit this week or do you have any questions I can help with?`,
  siteVisitConfirmEN: (leadName: string, project: string, when: string) =>
    `Hi ${leadName}, just confirming your site visit at ${project} on ${when}. I'll send you the location pin. See you then!`,
};

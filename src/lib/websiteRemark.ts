// ─────────────────────────────────────────────────────────────────────────────
// Website-form message → Conversation History entry (Lalit, 2026-06-20).
//
// When a real-time lead carries a genuine client message, it must appear in the
// lead's Conversation History (rawRemarks → Smart Timeline + Raw History) stamped
// at the LEAD-GENERATED time in IST — never the import/assign/edit time.
//
// The source / campaign / form / event NAME is NEVER a remark (#3): "Dubai
// Property Expo This Weekend", "DAMAC Expo", "Website Inquiry", "Facebook Lead
// Form", "Google Ads", "Inbound Call" belong in the Source section, not the
// conversation. websiteMessageRemark() returns null for those (and for blanks),
// so no duplicate / no empty timeline entry is ever created.
// ─────────────────────────────────────────────────────────────────────────────

// Generic channel / source labels that are never a real client message.
const GENERIC_SOURCE = /^(?:website(?:\s+(?:inquiry|enquiry|contact|lead|form|property))?|web\s*form|contact\s+form|facebook(?:\s+lead)?(?:\s+(?:form|ads?))?|fb(?:\s+ads?)?|meta(?:\s+lead)?(?:\s+ads?)?|instagram(?:\s+ads?)?|google(?:\s+ads?)?|inbound\s+call|outbound\s+call|phone\s+call|walk\s*-?\s*in|referral|portal|99\s*acres|magic\s*bricks|housing(?:\.com)?|expo|damac\s+expo|property\s+expo)$/i;

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** True when the "message" is really just the source / campaign / event name. */
export function isSourceEcho(message: string, sourceRaw?: string | null, sourceDetail?: string | null): boolean {
  const m = norm(message);
  if (!m) return true;
  if (m === norm(sourceRaw) || m === norm(sourceDetail)) return true;
  if (GENERIC_SOURCE.test(m)) return true;
  // Short event/campaign titles ("Dubai Property Expo This Weekend", "DAMAC Expo").
  const words = m.split(" ").length;
  if (words <= 6 && /\b(expo|campaign|webinar|roadshow|launch|open\s+house|mela|fair|carnival|property\s+show|road\s*show)\b/.test(m)) return true;
  return false;
}

/** "On 20 Jun 2026 (4:35 PM)" — IST, in the shape remarkParser dates an entry. */
export function fmtLeadGenIST(d: Date): string {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);
  return `On ${date} (${time})`;
}

/**
 * Build the Conversation-History entry for a genuine client message, stamped at
 * the lead-generated time (IST). Returns null when the message is empty or is
 * merely the source/campaign name — so callers never create a duplicate or a
 * blank timeline entry.
 */
export function websiteMessageRemark(
  message: string | null | undefined,
  createdAt: Date,
  opts: { tag?: string; sourceRaw?: string | null; sourceDetail?: string | null } = {},
): string | null {
  const msg = (message ?? "").trim();
  if (!msg) return null;
  if (isSourceEcho(msg, opts.sourceRaw, opts.sourceDetail)) return null;
  const tag = opts.tag ?? "Website / Client Message";
  return `${fmtLeadGenIST(createdAt)} ${tag}: ${msg}`;
}

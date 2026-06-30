import { NextResponse, type NextRequest } from "next/server";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource } from "@prisma/client";

// Accepts inbound emails from Cloudflare Email Routing / Postmark Inbound /
// SendGrid Inbound Parse / or a raw POST. Parses common Indian portal templates
// (99acres, MagicBricks, Housing.com) + falls back to generic.

interface RawInbound {
  from?: string;          // "Lead Name <lead@example.com>"
  to?: string;            // routed-to address
  subject?: string;
  text?: string;          // plain-text body
  html?: string;          // html body
  // Cloudflare email worker shape
  headers?: Record<string, string>;
  body?: string;
}

function extractEmail(s?: string): string | undefined {
  if (!s) return;
  const m = s.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m?.[0]?.toLowerCase();
}
function extractName(s?: string): string | undefined {
  if (!s) return;
  // "John Doe <john@x.com>" → "John Doe"
  const m = s.match(/^([^<]+?)\s*</);
  return m?.[1]?.trim();
}
function extractPhone(text: string): string | undefined {
  // Match international + Indian patterns
  const patterns = [
    /\+\s?\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/,  // +91 98 1234 5678
    /\b[6-9]\d{9}\b/,                                          // bare 10-digit Indian
    /\+?\d[\d\s-]{8,15}\d/,                                    // generic
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[0].trim();
  }
  return;
}

function classifySource(from?: string, subject?: string): { source: LeadSource; detail?: string } {
  const s = `${from ?? ""} ${subject ?? ""}`.toLowerCase();
  if (s.includes("99acres")) return { source: LeadSource.PORTAL_99ACRES, detail: "99acres email" };
  if (s.includes("magicbricks")) return { source: LeadSource.PORTAL_MAGICBRICKS, detail: "MagicBricks email" };
  if (s.includes("housing")) return { source: LeadSource.PORTAL_HOUSING, detail: "Housing.com email" };
  if (s.includes("facebook") || s.includes("meta")) return { source: LeadSource.FACEBOOK_ADS, detail: "Meta email" };
  if (s.includes("google ads") || s.includes("googleads")) return { source: LeadSource.GOOGLE_ADS, detail: "Google Ads email" };
  return { source: LeadSource.WEBSITE, detail: "Email intake" };
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ")
             .replace(/<script[\s\S]*?<\/script>/gi, " ")
             .replace(/<[^>]+>/g, " ")
             .replace(/&nbsp;/g, " ")
             .replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/\s+/g, " ")
             .trim();
}

export async function POST(req: NextRequest) {
  // Optional API key gate (recommended for production)
  const apiKey = req.headers.get("x-wcr-key") ?? new URL(req.url).searchParams.get("key");
  if (process.env.EMAIL_INTAKE_KEY && apiKey !== process.env.EMAIL_INTAKE_KEY) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as RawInbound;
  const fromRaw = body.from ?? body.headers?.from;
  const subject = body.subject ?? body.headers?.subject ?? "";
  const text = body.text ?? (body.html ? stripHtml(body.html) : body.body ?? "");

  if (!fromRaw && !text) return NextResponse.json({ error: "Empty email" }, { status: 400 });

  const senderEmail = extractEmail(fromRaw);
  const senderName  = extractName(fromRaw) ?? senderEmail?.split("@")[0] ?? "Email Lead";

  // Try to extract a phone from BODY (portal emails put the prospect's phone in the body, not the From)
  const phone = extractPhone(text);
  // Try to extract a SECOND email from body (portal emails have the prospect's email in body)
  const bodyEmails = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])
    .filter((e) => e.toLowerCase() !== senderEmail);
  const prospectEmail = bodyEmails[0]?.toLowerCase() ?? senderEmail;

  // Smart name pull: portal emails often have "Name: John Doe" or "from John Doe"
  const nameMatch = text.match(/(?:name|from)\s*[:\-]\s*([A-Za-z][A-Za-z\s.]{1,40})/i);
  const prospectName = nameMatch?.[1]?.trim() || senderName;

  const { source, detail } = classifySource(fromRaw, subject);

  const { lead, deduped } = await ingestLead({
    name: prospectName,
    phone,
    email: prospectEmail,
    source,
    autoAssign: true, // Lalit 2026-06-30: email-intake routes via the team rule
    sourceDetail: detail,
    // No truncation — store the full inbound email body verbatim (notesShort is
    // unlimited Postgres text). Previously sliced to 1500 chars (data loss).
    notesShort: `${subject}\n\n${text}`,
  });

  return NextResponse.json({ ok: true, leadId: lead.id, deduped, parsedFrom: fromRaw });
}

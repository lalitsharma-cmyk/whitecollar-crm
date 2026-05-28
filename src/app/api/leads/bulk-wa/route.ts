// Bulk WhatsApp for a list of leads.
// Posts: { leadIds: string[], templateKey?: "followup" | "checkin" | "newlisting" }
//
// WhatsApp can't be sent server-side here (no Meta Cloud API). Instead we build
// a LIST of wa.me draft links the agent opens one-by-one (each opens WhatsApp
// with the message pre-typed; the agent just taps Send).
//
// Each eligible lead is logged as a PLANNED WHATSAPP Activity so the outreach
// is tracked even before the agent actually opens/sends it. Leads with no phone
// are reported in `skipped`.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import { waDraftLink, WA_TEMPLATES } from "@/lib/wa";
import { ActivityType, ActivityStatus } from "@prisma/client";

// First word of the lead's name — falls back to "there" so the message never
// reads "Hi ,".
function firstName(name: string): string {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f || "there";
}

// A couple of presets. Default is followup. All are short, agent-tappable
// messages keyed off the lead's first name.
const TEMPLATES = {
  followup: (n: string) => WA_TEMPLATES.followupEN(n),
  checkin: (n: string) =>
    `Hi ${n}, just checking in — is there anything I can help you with on your property search? Happy to share a few options that match what you're looking for.`,
  newlisting: (n: string) =>
    `Hi ${n}, we've just had some new listings come in that match your requirements. Would you like me to send over the details and arrange a viewing?`,
} as const;

type TemplateKey = keyof typeof TEMPLATES;

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));

  const leadIds: string[] = Array.isArray(body.leadIds)
    ? body.leadIds.filter((x: unknown) => typeof x === "string")
    : [];
  if (leadIds.length === 0) {
    return NextResponse.json({ error: "No leads selected" }, { status: 400 });
  }

  const rawKey = String(body.templateKey ?? "followup");
  const templateKey: TemplateKey = (rawKey in TEMPLATES ? rawKey : "followup") as TemplateKey;
  const buildMessage = TEMPLATES[templateKey];

  // Scope to leads the caller owns/manages — same ownership rules as the rest
  // of the lead surface. Anything outside scope simply isn't returned.
  const scope = await leadScopeWhere(me);
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, ...scope },
    select: { id: true, name: true, phone: true },
  });

  const links: Array<{ leadId: string; name: string; phone: string; waLink: string }> = [];
  const skipped: Array<{ leadId: string; name: string; reason: string }> = [];

  for (const lead of leads) {
    const phone = (lead.phone ?? "").trim();
    if (!phone) {
      skipped.push({ leadId: lead.id, name: lead.name, reason: "No phone number" });
      continue;
    }
    const message = buildMessage(firstName(lead.name));
    const waLink = waDraftLink(phone, message);
    if (!waLink) {
      skipped.push({ leadId: lead.id, name: lead.name, reason: "Invalid phone number" });
      continue;
    }
    links.push({ leadId: lead.id, name: lead.name, phone, waLink });

    // Track the planned outreach so it shows on the lead timeline.
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: me.id,
        type: ActivityType.WHATSAPP,
        status: ActivityStatus.PLANNED,
        title: `💬 Bulk WhatsApp (${templateKey})`,
        description: message,
      },
    });
  }

  return NextResponse.json({ ok: true, links, skipped });
}

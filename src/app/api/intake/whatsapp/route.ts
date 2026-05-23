import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, WAMessageDirection } from "@prisma/client";

// Meta Cloud API webhook verification (GET handshake)
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const mode  = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

// Generic WhatsApp inbound — handles Meta Cloud API / Twilio / Gupshup-ish shapes
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-wcr-key") ?? new URL(req.url).searchParams.get("key");
  if (apiKey) {
    const key = await prisma.intakeKey.findUnique({ where: { key: apiKey } });
    if (!key || !key.active || key.source !== LeadSource.WHATSAPP) {
      return NextResponse.json({ error: "Invalid key" }, { status: 401 });
    }
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  // Try to extract from Meta Cloud API shape first
  type Msg = { from?: string; text?: { body?: string }; id?: string; profile?: { name?: string } };
  const messages: Msg[] = [];
  const entries = (body as { entry?: unknown[] }).entry ?? [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes ?? [];
    for (const ch of changes) {
      const value = (ch as { value?: { messages?: Msg[]; contacts?: { profile?: { name?: string }; wa_id?: string }[] } }).value;
      const contacts = value?.contacts ?? [];
      for (const m of value?.messages ?? []) {
        messages.push({
          from: m.from ?? contacts[0]?.wa_id,
          text: m.text,
          id: m.id,
          profile: contacts[0]?.profile,
        });
      }
    }
  }

  // Fallback for simple {from, body, name} shape (Twilio-like)
  if (messages.length === 0 && (body as { from?: string }).from) {
    const b = body as { from?: string; body?: string; name?: string };
    messages.push({ from: b.from, text: { body: b.body }, profile: { name: b.name } });
  }

  const results: Array<{ from: string; leadId: string; deduped: boolean }> = [];
  for (const m of messages) {
    const phone = m.from ?? "";
    const text = m.text?.body ?? "";
    const name = m.profile?.name ?? `WhatsApp ${phone.slice(-4)}`;
    if (!phone) continue;

    const { lead, deduped } = await ingestLead({
      name, phone, source: LeadSource.WHATSAPP, notesShort: text,
    });

    await prisma.whatsAppMessage.create({
      data: {
        leadId: lead.id,
        phoneNumber: phone,
        direction: WAMessageDirection.INBOUND,
        body: text,
        providerMsgId: m.id,
      },
    });

    results.push({ from: phone, leadId: lead.id, deduped });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

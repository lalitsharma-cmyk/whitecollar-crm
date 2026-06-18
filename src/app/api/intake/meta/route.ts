import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource } from "@prisma/client";

// ── Meta (Facebook + Instagram) Lead Ads — native webhook ────────────────────
// Free, real-time alternative to a Zapier bridge. Two phases:
//   GET  — Meta's subscription verification handshake (echoes hub.challenge).
//   POST — leadgen change events: for each, fetch the lead's field_data from the
//          Graph API and create a CRM lead (source FACEBOOK_ADS / Instagram).
//
// Dormant until these env vars are set (see INTEGRATIONS_SETUP.md):
//   META_VERIFY_TOKEN  — any string you also paste into Meta's webhook config
//   META_APP_SECRET    — App → Settings → Basic (verifies X-Hub-Signature-256)
//   META_PAGE_TOKEN    — long-lived Page access token (reads the lead)
// Until configured it still ACKs Meta (200) so retries don't pile up, but creates
// nothing. NO key needed — Meta authenticates via the signed payload.

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const mode = sp.get("hub.mode");
  const token = sp.get("hub.verify_token");
  const challenge = sp.get("hub.challenge");
  if (mode === "subscribe" && token && process.env.META_VERIFY_TOKEN && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

function verifySignature(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return true; // not configured — the token gate below still blocks creation
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

type FieldDatum = { name: string; values: string[] };
type LeadDetail = { field_data?: FieldDatum[]; ad_name?: string; form_name?: string; campaign_name?: string };
type MetaBody = {
  entry?: Array<{
    changes?: Array<{ field?: string; value?: { leadgen_id?: string; platform?: string } }>;
  }>;
};

async function fetchLead(leadgenId: string): Promise<Record<string, string> | null> {
  const token = process.env.META_PAGE_TOKEN;
  if (!token) return null;
  const url = `https://graph.facebook.com/v19.0/${leadgenId}?fields=field_data,ad_name,form_name,campaign_name&access_token=${token}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = (await r.json()) as LeadDetail;
  const out: Record<string, string> = {};
  for (const f of j.field_data ?? []) out[f.name.toLowerCase()] = (f.values ?? [])[0] ?? "";
  if (j.ad_name) out.__ad = j.ad_name;
  if (j.form_name) out.__form = j.form_name;
  if (j.campaign_name) out.__campaign = j.campaign_name;
  return out;
}

const KNOWN = new Set(["full_name", "full name", "phone_number", "phone", "email", "city", "first_name", "last_name"]);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Bad signature", { status: 401 });
  }
  // After signature passes, always 200 to Meta so it doesn't retry-storm.
  if (!process.env.META_PAGE_TOKEN) {
    console.warn("[intake/meta] leadgen received but META_PAGE_TOKEN unset — skipping create");
    return NextResponse.json({ ok: true, skipped: "not configured" });
  }

  let body: MetaBody;
  try { body = JSON.parse(raw) as MetaBody; } catch { return NextResponse.json({ ok: true }); }

  let created = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value?.leadgen_id) continue;
      try {
        const f = await fetchLead(change.value.leadgen_id);
        if (!f) continue;
        const name = f["full_name"] ?? f["full name"] ?? [f["first_name"], f["last_name"]].filter(Boolean).join(" ");
        const detail = [f.__campaign, f.__form, f.__ad].filter(Boolean).join(" · ");
        const extra = Object.entries(f)
          .filter(([k]) => !k.startsWith("__") && !KNOWN.has(k))
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ");
        await ingestLead({
          name: name || "Facebook Lead",
          phone: f["phone_number"] ?? f["phone"],
          email: f["email"],
          city: f["city"],
          source: LeadSource.FACEBOOK_ADS,
          sourceRaw: change.value.platform === "instagram" ? "Instagram Lead Ad" : "Meta Lead Ad",
          sourceDetail: detail || undefined,
          notesShort: extra || undefined,
        });
        created++;
      } catch (e) {
        console.error("[intake/meta] lead create failed", change.value.leadgen_id, e);
      }
    }
  }
  return NextResponse.json({ ok: true, created });
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ingestLead } from "@/lib/leadIngest";
import { sourceEnumLabel } from "@/lib/sourceLabel";
import { validEmail } from "@/lib/importValidate";

// ── Universal lead intake — ONE endpoint for EVERY source ────────────────────
// The lead source is derived from the IntakeKey, not the payload: a key labelled
// "Townscript" with source EVENT tags the lead EVENT/sourceRaw="Townscript"; a
// "Meta Lead Ads" key tags FACEBOOK_ADS, etc. So any bridge — Zapier / Make /
// Pabbly, a platform's native webhook, or a raw server POST — can drop a
// normalized lead and have it attributed, validated, deduped, team-routed and
// round-robined by the same ingestLead() pipeline the website uses.
//
//   POST /api/intake/lead
//   X-WCR-Key: <key>     (or ?key=<key>)
//   { name, phone?, email?, city?, country?, configuration?,
//     budgetMin?, budgetMax?, message?, sourceDetail?, sourceRaw?, project?, url? }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-WCR-Key",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

const Body = z
  .object({
    name: z.string().optional(),
    fullName: z.string().optional(), // Meta/Google sometimes send full_name
    phone: z.string().optional(),
    email: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    configuration: z.string().optional(),
    budgetMin: z.coerce.number().optional(),
    budgetMax: z.coerce.number().optional(),
    message: z.string().optional(),
    notes: z.string().optional(),
    sourceDetail: z.string().optional(),
    sourceRaw: z.string().optional(),
    project: z.string().optional(),
    url: z.string().optional(),
    utmSource: z.string().optional(),
    utmCampaign: z.string().optional(),
    tags: z.string().optional(),
  })
  .passthrough();

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-wcr-key") ?? new URL(req.url).searchParams.get("key");
  if (!apiKey) return NextResponse.json({ error: "Missing X-WCR-Key" }, { status: 401, headers: cors });

  const key = await prisma.intakeKey.findUnique({ where: { key: apiKey } });
  if (!key || !key.active) return NextResponse.json({ error: "Invalid or inactive key" }, { status: 401, headers: cors });
  // HR-scoped keys belong to the recruitment pipeline (/api/intake/hr) — they
  // must NEVER create a sales lead here.
  if (key.hrScope) return NextResponse.json({ error: "This key is HR-scoped; use /api/intake/hr" }, { status: 403, headers: cors });

  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422, headers: cors });
  }
  const d = parsed.data;

  const name = (d.name ?? d.fullName ?? "").trim();
  // Per the source-fidelity rule: validate contact fields, drop junk, never let
  // one column's value leak into another. ingestLead normalizes the phone to E.164.
  const email = d.email ? validEmail(d.email) : undefined;
  const rawPhone = d.phone?.trim();
  const phone = rawPhone && rawPhone.replace(/\D/g, "").length >= 8 ? rawPhone : undefined;

  if (!name && !phone && !email) {
    return NextResponse.json({ error: "Need at least one of name / phone / email" }, { status: 422, headers: cors });
  }

  const message = [d.message, d.notes].filter(Boolean).join(" · ") || undefined;

  const { lead, deduped } = await ingestLead({
    name: name || "Unknown",
    phone,
    email,
    city: d.city,
    country: d.country,
    source: key.source,
    currentStatus: "Fresh Lead", // real-time intake → Fresh Lead (imports set their own)
    // Verbatim source: explicit payload value → key label → friendly enum label.
    // Never a raw enum token.
    sourceRaw: d.sourceRaw?.trim() || key.label || sourceEnumLabel(key.source),
    sourceDetail: d.sourceDetail ?? d.utmCampaign ?? d.utmSource ?? d.project,
    projectSlug: d.project,
    url: d.url,
    configuration: d.configuration,
    budgetMin: d.budgetMin,
    budgetMax: d.budgetMax,
    notesShort: message,
    tags: d.tags,
  });

  await prisma.intakeKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } });
  return NextResponse.json({ ok: true, deduped, leadId: lead.id, source: key.source }, { headers: cors });
}

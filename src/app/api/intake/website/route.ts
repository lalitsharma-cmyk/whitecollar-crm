import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ingestLead } from "@/lib/leadIngest";
import { classifyForIntake } from "@/lib/classifyForIntake";
import { LeadSource } from "@prisma/client";

const Body = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  configuration: z.string().optional(),
  budgetMin: z.coerce.number().optional(),
  budgetMax: z.coerce.number().optional(),
  message: z.string().optional(),
  project: z.string().optional(),  // campaign / source detail
  utmSource: z.string().optional(),
  utmCampaign: z.string().optional(),
});

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-WCR-Key",
    },
  });
}

export async function POST(req: NextRequest) {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-WCR-Key",
  };

  const apiKey = req.headers.get("x-wcr-key") ?? new URL(req.url).searchParams.get("key");
  if (!apiKey) return NextResponse.json({ error: "Missing X-WCR-Key" }, { status: 401, headers: cors });

  const key = await prisma.intakeKey.findUnique({ where: { key: apiKey } });
  if (!key || !key.active || key.source !== LeadSource.WEBSITE) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401, headers: cors });
  }

  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }

  const parsed = Body.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422, headers: cors });
  }
  const d = parsed.data;

  const sourceDetail = d.utmCampaign ?? d.utmSource ?? d.project;
  const classification = await classifyForIntake({
    source: LeadSource.WEBSITE, sourceRaw: key.label, sourceDetail,
    project: d.project, message: d.message, city: d.city,
  });

  const { lead, deduped } = await ingestLead({
    name: d.name,
    phone: d.phone,
    email: d.email,
    city: d.city,
    country: d.country,
    source: LeadSource.WEBSITE,
    currentStatus: "Fresh Lead",
    sourceDetail,
    projectSlug: d.project,
    configuration: d.configuration,
    budgetMin: d.budgetMin,
    budgetMax: d.budgetMax,
    notesShort: d.message,
    classification,
  });

  await prisma.intakeKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } });

  return NextResponse.json({ ok: true, deduped, leadId: lead.id }, { headers: cors });
}

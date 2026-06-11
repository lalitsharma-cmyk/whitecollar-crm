// Acefone webhook receiver — Acefone POSTs (or GETs) here on every call event.
//
// Setup: in Acefone dashboard, point all triggers to
//   https://crm.whitecollarrealty.com/api/acefone/webhook?token=<ACEFONE_WEBHOOK_TOKEN>
// Method: POST, content-type application/json (or form-urlencoded — we handle both).
//
// We expect $-prefixed Acefone fields:
//   $uuid, $call_id, $call_to_number, $caller_id_number, $direction,
//   $start_stamp, $answer_stamp, $end_stamp, $duration, $billsec,
//   $call_status, $ref_id, $custom_identifier, $recording_url (when ready), $agent_number
//
// Strategy:
//   - On every event, upsert a CallLog by acefone uuid (we reuse ivrCallId field).
//   - When the call ends (have $end_stamp + $duration), create an Activity entry too.
//   - Match phone → existing lead by fingerprint. If no lead matches and it's
//     inbound, optionally create one (controlled by ACEFONE_AUTO_CREATE_INBOUND).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookToken, normalizePhone } from "@/lib/acefone";
import { CallDirection, CallOutcome, ActivityType, ActivityStatus, LeadSource } from "@prisma/client";
import { ingestLead } from "@/lib/leadIngest";
import { fingerprintFor } from "@/lib/assignment";

export const dynamic = "force-dynamic";

// Accept POST (Acefone default) AND GET (some setups use GET) AND form-urlencoded.
export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest)  { return handle(req); }

async function handle(req: NextRequest) {
  const u = new URL(req.url);
  const token = u.searchParams.get("token");
  if (!verifyWebhookToken(token)) {
    return NextResponse.json({ error: "Invalid webhook token" }, { status: 401 });
  }

  // Body could be JSON, form-urlencoded, or empty (when GET — query string only).
  const body = await readBody(req);
  const data: Record<string, string> = {};

  // Merge query params + body, normalising "$field" → "field"
  for (const [k, v] of u.searchParams.entries()) data[k.replace(/^\$/, "")] = String(v);
  for (const [k, v] of Object.entries(body)) data[k.replace(/^\$/, "")] = String(v ?? "");

  const uuid = data.uuid || data.call_id;
  if (!uuid) {
    return NextResponse.json({ ok: false, error: "Missing uuid/call_id" }, { status: 400 });
  }

  const direction = (data.direction || "").toLowerCase() === "inbound"
    ? CallDirection.INBOUND : CallDirection.OUTBOUND;

  // Pick the "other party" number based on direction
  const leadPhone = normalizePhone(
    direction === CallDirection.INBOUND ? data.caller_id_number : data.call_to_number
  );
  const agentExt = data.agent_number || null;

  // ── Find or create the lead ─────────────────────────────────────────
  let leadId: string | null = null;
  if (leadPhone) {
    const fp = fingerprintFor(leadPhone, undefined);
    // Only match ACTIVE leads — a soft-deleted lead must not capture an inbound call.
    const existing = fp ? await prisma.lead.findFirst({ where: { fingerprint: fp, deletedAt: null } }) : null;
    if (existing) {
      leadId = existing.id;
    } else if (direction === CallDirection.INBOUND && process.env.ACEFONE_AUTO_CREATE_INBOUND === "true") {
      const r = await ingestLead({
        name: `Inbound caller ${leadPhone.slice(-4)}`,
        phone: leadPhone,
        source: LeadSource.INBOUND_CALL,
        sourceDetail: "Acefone inbound call",
      });
      leadId = r.lead.id;
    }
  }

  // ── Match Acefone agent → CRM user ─────────────────────────────────
  let userId: string | null = null;
  if (agentExt) {
    const user = await prisma.user.findFirst({ where: { acefoneAgentId: agentExt } });
    if (user) userId = user.id;
  }
  // Fallback to the lead's owner if we couldn't match the extension
  if (!userId && leadId) {
    const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
    userId = l?.ownerId ?? null;
  }
  // Last resort: first admin (so the CallLog isn't orphaned — userId is required)
  if (!userId) {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    userId = admin?.id ?? null;
  }
  if (!userId) {
    // No users in DB at all — nothing we can do
    return NextResponse.json({ ok: false, error: "No user to attribute call to" }, { status: 500 });
  }

  const outcome = mapOutcome(data.call_status);
  const durationSec = Number(data.billsec || data.duration || 0) || undefined;
  const startedAt  = parseTs(data.start_stamp)  ?? new Date();
  const endedAt    = parseTs(data.end_stamp);
  const recordingUrl = data.recording_url || null;

  // ── Upsert CallLog (idempotent: Acefone retries up to 2x) ──────────
  const existingLog = await prisma.callLog.findUnique({ where: { ivrCallId: uuid } });
  if (existingLog) {
    await prisma.callLog.update({
      where: { ivrCallId: uuid },
      data: {
        leadId: existingLog.leadId ?? leadId,
        userId: existingLog.userId ?? userId,
        durationSec: durationSec ?? existingLog.durationSec,
        outcome,
        endedAt: endedAt ?? existingLog.endedAt,
        recordingUrl: recordingUrl ?? existingLog.recordingUrl,
      },
    });
  } else {
    await prisma.callLog.create({
      data: {
        ivrProvider: "acefone",
        ivrCallId: uuid,
        leadId,
        userId,
        direction,
        phoneNumber: leadPhone ?? "(unknown)",
        durationSec,
        outcome,
        startedAt,
        endedAt,
        recordingUrl,
      },
    });
  }

  // ── On call end, also drop a timeline Activity ─────────────────────
  if (leadId && (endedAt || data.call_status)) {
    await prisma.activity.create({
      data: {
        leadId,
        userId,
        type: ActivityType.CALL,
        status: ActivityStatus.DONE,
        title: `Call ${direction.toLowerCase()} · ${outcome.replaceAll("_", " ")}${durationSec ? ` · ${Math.round(durationSec)}s` : ""}`,
        description: recordingUrl ? `Recording: ${recordingUrl}` : undefined,
        completedAt: endedAt ?? new Date(),
      },
    });
    await prisma.lead.update({
      where: { id: leadId },
      data: { lastTouchedAt: endedAt ?? new Date(), slaEscalated: false },
    });
  }

  return NextResponse.json({ ok: true, uuid, leadId, userId, outcome });
}

// ── helpers ──────────────────────────────────────────────────────────

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    return await req.json().catch(() => ({}));
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    if (!fd) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) out[k] = v.toString();
    return out;
  }
  // Empty body (GET) is fine
  return {};
}

function parseTs(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  // Acefone sends ISO strings or unix seconds
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return new Date(n > 1e12 ? n : n * 1000);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

function mapOutcome(status: string | undefined): CallOutcome {
  const s = (status || "").toLowerCase();
  if (s.includes("answer")) return CallOutcome.CONNECTED;
  if (s.includes("miss") || s.includes("no_answer") || s.includes("noanswer")) return CallOutcome.NOT_PICKED;
  if (s.includes("busy")) return CallOutcome.BUSY;
  if (s.includes("fail") || s.includes("congest")) return CallOutcome.SWITCHED_OFF;
  return CallOutcome.NOT_PICKED;
}

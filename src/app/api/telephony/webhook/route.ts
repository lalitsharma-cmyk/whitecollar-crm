// Provider-agnostic telephony webhook receiver.
//
// Point your provider's call-event webhook here:
//   https://crm.whitecollarrealty.com/api/telephony/webhook?token=<AS_PHONE_WEBHOOK_TOKEN>
// Method POST (JSON or form-urlencoded). GET is also accepted (query-only setups).
//
// Flow: verify (HMAC secret and/or ?token) → log the raw event verbatim (audit) →
// normalize via the active provider → record (idempotent upsert + timeline drop).
// On a processing error the raw event is queued for retry so nothing is lost.
import { NextResponse, type NextRequest } from "next/server";
import { telephonyConfig } from "@/lib/telephony/config";
import { providerSpec } from "@/lib/telephony/providers";
import { logRawEvent, markEventProcessed } from "@/lib/telephony/eventLog";
import { recordCallEvent } from "@/lib/telephony/recordCall";
import { enqueue } from "@/lib/telephony/retryQueue";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const cfg = telephonyConfig();
  const spec = providerSpec(cfg.provider);
  const u = new URL(req.url);

  // Read raw bytes once (needed for HMAC), then parse into a flat string map.
  const rawBody = await req.text().catch(() => "");
  const bodyMap = parseBody(req.headers.get("content-type") ?? "", rawBody);

  const data: Record<string, string> = {};
  const rawAll: Record<string, unknown> = {};
  for (const [k, v] of u.searchParams.entries()) { const key = k.replace(/^\$/, ""); data[key] = String(v); rawAll[key] = v; }
  for (const [k, v] of Object.entries(bodyMap)) { const key = k.replace(/^\$/, ""); data[key] = String(v ?? ""); rawAll[key] = v; }

  // ── Authenticity ────────────────────────────────────────────────────────────
  const signature = req.headers.get("x-signature") || req.headers.get("x-as-signature") || req.headers.get("x-webhook-signature");
  const ok = spec.verifyWebhook({ token: u.searchParams.get("token"), signature, rawBody }, cfg);
  if (!ok) return NextResponse.json({ error: "Invalid webhook signature/token" }, { status: 401 });

  // ── Parse + audit (log verbatim BEFORE processing) ──────────────────────────
  const parsed = spec.parseWebhook(data, cfg);
  const eventId = await logRawEvent(cfg.provider, rawAll, parsed).catch(() => null);
  if (!parsed) {
    return NextResponse.json({ ok: true, ignored: "not a call event" });
  }

  // ── Record (idempotent). On failure → retry queue, still 200 so the provider
  //    doesn't hammer us; we own the retry. ───────────────────────────────────
  try {
    const r = await recordCallEvent(parsed);
    if (eventId) await markEventProcessed(eventId, r.callLogId, null);
    return NextResponse.json({ ok: true, callLogId: r.callLogId, linked: r.leadId ? "lead" : r.buyerId ? "buyer" : "none", outcome: r.outcome });
  } catch (e) {
    const msg = String(e).slice(0, 300);
    if (eventId) await markEventProcessed(eventId, null, msg);
    await enqueue("WEBHOOK", cfg.provider, parsed.providerCallId, parsed as unknown).catch(() => {});
    return NextResponse.json({ ok: true, queuedForRetry: true });
  }
}

function parseBody(contentType: string, rawBody: string): Record<string, unknown> {
  if (!rawBody) return {};
  if (contentType.includes("application/json")) {
    try { return JSON.parse(rawBody); } catch { return {}; }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(rawBody).entries()) out[k] = v;
    return out;
  }
  // Unknown content-type → try JSON as a last resort.
  try { return JSON.parse(rawBody); } catch { return {}; }
}

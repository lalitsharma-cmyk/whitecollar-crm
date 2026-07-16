// Acefone cloud-telephony client.
//
// Two pieces:
//   1. clickToCall()   — server-to-server REST: rings the agent first, then dials
//                        the lead. Returns immediately; the call lifecycle arrives
//                        via webhook.
//   2. webhook payloads — handled in /api/acefone/webhook (this lib only owns the
//                        outbound side).
//
// Setup checklist (Lalit-side):
//   - ACEFONE_API_KEY        = bearer token from Acefone dashboard → API Tokens
//   - ACEFONE_DID_NUMBER     = the virtual number to mask agents with
//   - ACEFONE_WEBHOOK_TOKEN  = a shared secret you also paste into Acefone's
//                              webhook URL as ?token=… (Acefone doesn't sign
//                              requests, so this is our spoof guard)
//   - ACEFONE_BASE_URL       = optional override; defaults to api.acefone.in
//                              (use api.acefone.co.uk for UK accounts)
// All optional — if ACEFONE_API_KEY is missing, every helper is a no-op and the
// UI hides the button.

const DEFAULT_BASE = "https://api.acefone.in";

export function acefoneEnabled(): boolean {
  return !!(process.env.ACEFONE_API_KEY && process.env.ACEFONE_DID_NUMBER);
}

export interface ClickToCallParams {
  agentNumber: string;     // Acefone agent id mapped on user.acefoneAgentId
  destinationNumber: string; // lead's phone (E.164: "+9715…")
  /** Echoed back in the webhook so we can link the call to our internal CallLog. */
  customIdentifier?: string;
  /** Auto-hangup after N seconds (Acefone default is no limit). */
  callTimeoutSec?: number;
}

export interface ClickToCallResult {
  ok: boolean;
  message: string;
  raw?: unknown;
}

/**
 * Fires an Acefone click-to-call. Returns quickly — actual call lifecycle
 * (answered / hung up / recorded) shows up via webhook later.
 *
 * POST https://api.acefone.in/v1/click_to_call
 *   Authorization: Bearer <ACEFONE_API_KEY>
 *   Content-Type: application/json
 *   { agent_number, destination_number, async, caller_id?, call_timeout?, custom_identifier? }
 */
export async function clickToCall(p: ClickToCallParams): Promise<ClickToCallResult> {
  if (!acefoneEnabled()) {
    return { ok: false, message: "Acefone not configured (ACEFONE_API_KEY missing)" };
  }
  const base = process.env.ACEFONE_BASE_URL ?? DEFAULT_BASE;
  const did = process.env.ACEFONE_DID_NUMBER!;
  const body = {
    agent_number: p.agentNumber,
    destination_number: p.destinationNumber,
    async: "1",          // never block our request thread waiting for the call
    caller_id: did,      // what the lead sees
    ...(p.callTimeoutSec ? { call_timeout: p.callTimeoutSec } : {}),
    ...(p.customIdentifier ? { custom_identifier: p.customIdentifier } : {}),
  };
  try {
    const r = await fetch(`${base}/v1/click_to_call`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ACEFONE_API_KEY!}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = text; }
    if (!r.ok) {
      return { ok: false, message: `Acefone error ${r.status}: ${text.slice(0, 200)}`, raw };
    }
    // Acefone returns { Success: boolean, Message: string }
    const j = raw as { Success?: boolean; Message?: string } | undefined;
    const success = j?.Success === true;
    return { ok: success, message: j?.Message ?? (success ? "Call initiated" : "Unknown response"), raw };
  } catch (e) {
    return { ok: false, message: `Network error: ${String(e).slice(0, 200)}` };
  }
}

/** Verifies the inbound webhook token query param against ACEFONE_WEBHOOK_TOKEN. */
export function verifyWebhookToken(provided: string | null): boolean {
  const expected = process.env.ACEFONE_WEBHOOK_TOKEN;
  if (!expected) {
    // Fail CLOSED in production (W5 security audit L2): an unset token must not
    // make the CallLog-writing webhook anonymously spoofable. Permissive only in
    // dev/local setup. Mirrors the intake/email + intake/meta hardening.
    return process.env.NODE_ENV !== "production";
  }
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Normalizes Acefone phone numbers ("+91…", "91…", "00…") to leading-"+" E.164. */
export function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  let v = String(s).trim().replace(/[^\d+]/g, "");
  if (!v) return null;
  if (v.startsWith("00")) v = "+" + v.slice(2);
  else if (!v.startsWith("+")) v = "+" + v;
  return v;
}

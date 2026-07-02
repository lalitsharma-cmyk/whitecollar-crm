// Telephony provider registry. Add a provider = add one entry here; the routes,
// linking, timeline, retry queue and admin console are all provider-agnostic.
//
// Pure functions (buildClickToCall / parse* / parseWebhook) do NO network I/O so
// they're unit-tested against sample JSON in providers.test.ts.
import type {
  TelephonyProviderSpec, TelephonyConfig, ClickToCallParams, ClickToCallResult,
  PreparedRequest, WebhookVerifyInput, NormalizedCallEvent, CallDir,
} from "./types";
import { normalizePhone, pick, parseTs } from "./normalize";
import { verifyHmac, safeEqual } from "./signature";

function dirOf(raw: string | null): CallDir {
  return (raw || "").toLowerCase().startsWith("in") ? "inbound" : "outbound";
}

// ─────────────────────────────────────────────────────────────────────────────
// AS Phone — modern REST provider (Bearer API key + Account-Id header + HMAC).
//
// If AS Phone's actual field names differ from the tolerant aliases below, they
// are the ONLY thing to adjust — one map, documented in docs/AS_PHONE_SETUP.md.
// The tolerant aliasing means most standard REST telephony wire formats already
// map with zero code change.
// ─────────────────────────────────────────────────────────────────────────────
const asphone: TelephonyProviderSpec = {
  name: "asphone",
  defaultBaseUrl: "https://api.asphone.io",

  isConfigured: (c) => !!(c.apiKey && c.accountId && c.didNumber),
  missing: (c) => {
    const m: string[] = [];
    if (!c.accountId) m.push("Account ID");
    if (!c.apiKey) m.push("API Key");
    if (!c.didNumber) m.push("DID / Caller-ID");
    return m;
  },

  buildClickToCall: (p, c): PreparedRequest => {
    const base = c.baseUrl || asphone.defaultBaseUrl;
    return {
      url: `${base}/v1/calls`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "X-Account-Id": c.accountId ?? "",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: c.didNumber,           // caller-id shown to the lead
        to: p.destinationNumber,     // the lead/buyer
        agent: p.agentExt,           // ring the agent first
        async: true,
        ...(p.callTimeoutSec ? { timeout: p.callTimeoutSec } : {}),
        ...(p.customIdentifier ? { reference: p.customIdentifier } : {}),
      }),
    };
  },

  parseClickToCall: (status, json): ClickToCallResult => {
    const j = (json ?? {}) as Record<string, unknown>;
    const id = (j.id ?? j.call_id ?? j.callId ?? j.uuid) as string | undefined;
    const okFlag = j.success === true || j.ok === true || (status >= 200 && status < 300);
    const message = (j.message ?? j.error ?? (okFlag ? "Call initiated" : "Call rejected")) as string;
    if (!okFlag) {
      // 429 / 5xx are worth retrying; 4xx (bad number, auth) are not.
      const retryable = status === 429 || status >= 500;
      return { ok: false, message: `${status}: ${message}`, retryable, raw: json };
    }
    return { ok: true, message, providerCallId: id ?? null, raw: json };
  },

  verifyWebhook: (input, c): boolean => {
    // Either guard is sufficient. Prefer HMAC when a Secret is configured.
    if (c.secret && verifyHmac(input.rawBody, c.secret, input.signature)) return true;
    if (c.webhookToken) return safeEqual(input.token, c.webhookToken);
    // FAIL-CLOSED: with neither a Secret nor a Webhook Token configured the endpoint
    // has no legitimate caller (no credentials = telephony is inert), so an unsigned
    // webhook is rejected. The setup doc requires setting at least one guard.
    return false;
  },

  parseWebhook: (data): NormalizedCallEvent | null => {
    const providerCallId = pick(data, ["call_id", "callId", "id", "uuid"]);
    if (!providerCallId) return null;
    const direction = dirOf(pick(data, ["direction", "call_direction", "type"]));
    const otherRaw = direction === "inbound"
      ? pick(data, ["from", "from_number", "caller", "caller_id_number", "source"])
      : pick(data, ["to", "to_number", "destination", "call_to_number", "callee"]);
    const started = parseTs(pick(data, ["started_at", "start_time", "start_stamp", "start"]));
    const ended = parseTs(pick(data, ["ended_at", "end_time", "end_stamp", "end"]));
    const durStr = pick(data, ["duration", "billsec", "talk_time", "call_duration"]);
    return {
      provider: "asphone",
      providerCallId,
      accountId: pick(data, ["account_id", "accountId"]),
      direction,
      otherNumber: normalizePhone(otherRaw),
      agentExt: pick(data, ["agent", "agent_id", "agent_number", "extension", "ext"]),
      status: pick(data, ["status", "call_status", "disposition", "outcome"]),
      startedAt: started,
      endedAt: ended,
      durationSec: durStr != null ? Number(durStr) || null : null,
      recordingUrl: pick(data, ["recording_url", "recordingUrl", "recording", "record_url"]),
      customIdentifier: pick(data, ["reference", "custom_identifier", "identifier", "ref_id"]),
      eventType: pick(data, ["event", "event_type", "status", "call_status"]),
    };
  },

  buildListRecent: (sinceISO, c): PreparedRequest => {
    const base = c.baseUrl || asphone.defaultBaseUrl;
    return {
      url: `${base}/v1/calls?since=${encodeURIComponent(sinceISO)}`,
      method: "GET",
      headers: { Authorization: `Bearer ${c.apiKey}`, "X-Account-Id": c.accountId ?? "", Accept: "application/json" },
    };
  },
  parseListRecent: (json): NormalizedCallEvent[] => {
    const j = (json ?? {}) as Record<string, unknown>;
    const rows = (Array.isArray(j.data) ? j.data : Array.isArray(j.calls) ? j.calls : Array.isArray(json) ? json : []) as Record<string, string>[];
    return rows.map((r) => asphone.parseWebhook(r, {} as TelephonyConfig)).filter((e): e is NormalizedCallEvent => !!e);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Acefone — legacy provider (kept so the existing setup never regresses). Bearer
// API key, $-prefixed webhook fields, ?token= guard (Acefone doesn't sign).
// ─────────────────────────────────────────────────────────────────────────────
const acefone: TelephonyProviderSpec = {
  name: "acefone",
  defaultBaseUrl: "https://api.acefone.in",

  isConfigured: (c) => !!(c.apiKey && c.didNumber),
  missing: (c) => {
    const m: string[] = [];
    if (!c.apiKey) m.push("API Key");
    if (!c.didNumber) m.push("DID / Caller-ID");
    return m;
  },

  buildClickToCall: (p, c): PreparedRequest => {
    const base = c.baseUrl || acefone.defaultBaseUrl;
    return {
      url: `${base}/v1/click_to_call`,
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        agent_number: p.agentExt,
        destination_number: p.destinationNumber,
        async: "1",
        caller_id: c.didNumber,
        ...(p.callTimeoutSec ? { call_timeout: p.callTimeoutSec } : {}),
        ...(p.customIdentifier ? { custom_identifier: p.customIdentifier } : {}),
      }),
    };
  },
  parseClickToCall: (status, json): ClickToCallResult => {
    const j = (json ?? {}) as { Success?: boolean; Message?: string };
    const ok = j?.Success === true;
    if (!ok) return { ok: false, message: `${status}: ${j?.Message ?? "Unknown response"}`, retryable: status === 429 || status >= 500, raw: json };
    return { ok: true, message: j?.Message ?? "Call initiated", raw: json };
  },

  verifyWebhook: (input, c): boolean => {
    if (!c.webhookToken) return false; // fail-closed: no token configured → reject
    return safeEqual(input.token, c.webhookToken);
  },
  parseWebhook: (data): NormalizedCallEvent | null => {
    // Acefone $-prefixes are already stripped by the route before this runs.
    const providerCallId = pick(data, ["uuid", "call_id"]);
    if (!providerCallId) return null;
    const direction = dirOf(pick(data, ["direction"]));
    const otherRaw = direction === "inbound" ? pick(data, ["caller_id_number"]) : pick(data, ["call_to_number"]);
    return {
      provider: "acefone",
      providerCallId,
      accountId: pick(data, ["account_id"]),
      direction,
      otherNumber: normalizePhone(otherRaw),
      agentExt: pick(data, ["agent_number"]),
      status: pick(data, ["call_status"]),
      startedAt: parseTs(pick(data, ["start_stamp"])),
      endedAt: parseTs(pick(data, ["end_stamp"])),
      durationSec: (() => { const d = pick(data, ["billsec", "duration"]); return d != null ? Number(d) || null : null; })(),
      recordingUrl: pick(data, ["recording_url"]),
      customIdentifier: pick(data, ["custom_identifier", "ref_id"]),
      eventType: pick(data, ["call_status"]),
    };
  },
};

export const PROVIDERS: Record<string, TelephonyProviderSpec> = { asphone, acefone };

export function isProvider(name: string): boolean {
  return name.toLowerCase() in PROVIDERS;
}

/** Resolve the spec for a provider name, defaulting to asphone for unknowns. */
export function providerSpec(name: string): TelephonyProviderSpec {
  return PROVIDERS[name.toLowerCase()] ?? asphone;
}

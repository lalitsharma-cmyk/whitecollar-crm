// Provider-agnostic telephony layer — shared types.
//
// The whole point: WCR can switch cloud-telephony providers (AS Phone, Acefone, …)
// by changing config only. Every provider implements `TelephonyProviderSpec`; the
// rest of the CRM only ever sees the NORMALIZED shapes below. Mirrors the AI-engine
// registry pattern (src/lib/ai/providers.ts).

/** The five credential placeholders the owner pastes once numbers are purchased. */
export interface TelephonyConfig {
  provider: string;      // "asphone" | "acefone" | …  (TELEPHONY_PROVIDER)
  accountId: string | null;   // AS_PHONE_ACCOUNT_ID
  apiKey: string | null;      // AS_PHONE_API_KEY
  secret: string | null;      // AS_PHONE_SECRET       (webhook HMAC signing)
  baseUrl: string | null;     // AS_PHONE_BASE_URL     (provider default if unset)
  didNumber: string | null;   // AS_PHONE_DID          (caller-id the lead sees)
  webhookToken: string | null;// AS_PHONE_WEBHOOK_TOKEN(shared-secret query guard)
}

export type CallDir = "inbound" | "outbound";

/** A telephony call event AFTER normalization — the only call shape the CRM stores. */
export interface NormalizedCallEvent {
  provider: string;
  providerCallId: string;        // stable id used for idempotent upsert (CallLog.ivrCallId)
  accountId: string | null;
  direction: CallDir;
  /** The OTHER party (the lead/buyer) — already E.164-normalized ("+9715…"). */
  otherNumber: string | null;
  /** The agent's telephony extension/id — matched to user.acefoneAgentId. */
  agentExt: string | null;
  /** Provider status label, verbatim (mapped to CallOutcome in recordCall). */
  status: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  recordingUrl: string | null;
  /** Echoed identifier we set on outbound dials, e.g. "lead:abc" / "buyer:xyz". */
  customIdentifier: string | null;
  /** Verbatim event/status label for CallEvent.eventType (audit). */
  eventType: string | null;
}

export interface ClickToCallParams {
  agentExt: string;         // user.acefoneAgentId (generic telephony ext/id)
  destinationNumber: string; // E.164
  customIdentifier?: string; // "lead:<id>" | "buyer:<id>" — echoed back on webhook
  callTimeoutSec?: number;
}

export interface ClickToCallResult {
  ok: boolean;
  message: string;
  providerCallId?: string | null;
  /** true → transient failure worth enqueueing on the retry queue. */
  retryable?: boolean;
  raw?: unknown;
}

/** A prepared outbound HTTP request (kept pure so it's unit-testable w/o network). */
export interface PreparedRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

/** Inputs a provider needs to verify an inbound webhook (no framework types here). */
export interface WebhookVerifyInput {
  token: string | null;        // ?token= query param
  signature: string | null;    // provider signature header (if any)
  rawBody: string;             // exact bytes, for HMAC
}

/**
 * One cloud-telephony provider. Pure functions + async network calls kept separate
 * so buildRequest/parse* can be unit-tested against sample JSON with no network.
 */
export interface TelephonyProviderSpec {
  name: string;
  /** Provider default base URL when config.baseUrl is unset. */
  defaultBaseUrl: string;
  /** Ready to place/receive calls given the current config? */
  isConfigured(cfg: TelephonyConfig): boolean;
  /** Human-readable list of which required creds are still missing. */
  missing(cfg: TelephonyConfig): string[];

  // ── Outbound (click-to-call) ──────────────────────────────────────────────
  buildClickToCall(p: ClickToCallParams, cfg: TelephonyConfig): PreparedRequest;
  parseClickToCall(status: number, json: unknown): ClickToCallResult;

  // ── Inbound (webhook) ─────────────────────────────────────────────────────
  verifyWebhook(input: WebhookVerifyInput, cfg: TelephonyConfig): boolean;
  /** Normalize a merged {query+body} webhook map. Returns null if not a call event. */
  parseWebhook(data: Record<string, string>, cfg: TelephonyConfig): NormalizedCallEvent | null;

  // ── Sync engine (reconcile dropped webhooks) — optional ───────────────────
  buildListRecent?(sinceISO: string, cfg: TelephonyConfig): PreparedRequest;
  parseListRecent?(json: unknown, cfg: TelephonyConfig): NormalizedCallEvent[];
}

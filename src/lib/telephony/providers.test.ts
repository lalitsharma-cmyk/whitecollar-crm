// Telephony layer unit tests — PURE (no network, no DB). Run with tsx.
// Covers: provider request-building, response + webhook parsing, HMAC/token auth,
// phone normalization, and config resolution/back-compat.
import { PROVIDERS, providerSpec, isProvider } from "./providers";
import { normalizePhone, last10, pick, parseTs } from "./normalize";
import { hmacHex, verifyHmac, safeEqual } from "./signature";
import type { TelephonyConfig } from "./types";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

const cfg = (over: Partial<TelephonyConfig> = {}): TelephonyConfig => ({
  provider: "asphone", accountId: "ACC1", apiKey: "KEY1", secret: "S3cr3t", baseUrl: null, didNumber: "+97140000000", webhookToken: "TOK", ...over,
});

// ── Registry ────────────────────────────────────────────────────────────────
ok("registry has asphone + acefone", isProvider("asphone") && isProvider("acefone"));
ok("unknown provider → asphone default", providerSpec("nope").name === "asphone");

// ── AS Phone: configured / missing ────────────────────────────────────────────
const as = PROVIDERS.asphone;
ok("asphone configured when acct+key+did set", as.isConfigured(cfg()));
ok("asphone reports missing DID", as.missing(cfg({ didNumber: null })).includes("DID / Caller-ID"));
ok("asphone reports missing API Key + Account ID", (() => { const m = as.missing(cfg({ apiKey: null, accountId: null })); return m.includes("API Key") && m.includes("Account ID"); })());

// ── AS Phone: click-to-call request shape ─────────────────────────────────────
const ctc = as.buildClickToCall({ agentExt: "101", destinationNumber: "+919812345678", customIdentifier: "lead:abc" }, cfg());
ok("asphone posts to /v1/calls", ctc.method === "POST" && ctc.url.endsWith("/v1/calls"));
ok("asphone key in Bearer header, NOT the url", ctc.headers.Authorization === "Bearer KEY1" && !ctc.url.includes("KEY1"));
ok("asphone sends X-Account-Id header", ctc.headers["X-Account-Id"] === "ACC1");
ok("asphone body carries from(DID)/to/agent/reference", (() => { const b = JSON.parse(ctc.body!); return b.from === "+97140000000" && b.to === "+919812345678" && b.agent === "101" && b.reference === "lead:abc"; })());
ok("asphone honors baseUrl override", as.buildClickToCall({ agentExt: "1", destinationNumber: "+9711" }, cfg({ baseUrl: "https://eu.example.com" })).url.startsWith("https://eu.example.com/"));

// ── AS Phone: click-to-call response parsing ──────────────────────────────────
ok("asphone 2xx → ok + call id", (() => { const r = as.parseClickToCall(200, { id: "C123", message: "queued" }); return r.ok && r.providerCallId === "C123"; })());
ok("asphone 4xx → not ok + NOT retryable", (() => { const r = as.parseClickToCall(400, { message: "bad number" }); return !r.ok && r.retryable === false; })());
ok("asphone 429/5xx → retryable", (() => { const a = as.parseClickToCall(429, {}); const b = as.parseClickToCall(503, {}); return a.retryable === true && b.retryable === true; })());

// ── AS Phone: webhook parsing (tolerant aliases) ──────────────────────────────
const wh = as.parseWebhook({
  call_id: "CALL9", direction: "inbound", from: "00919812345678", to: "+97140000000",
  agent: "101", status: "answered", start_time: "1700000000", duration: "42",
  recording_url: "https://api.asphone.io/rec/9.mp3", reference: "lead:abc",
}, cfg());
ok("asphone webhook → providerCallId", wh?.providerCallId === "CALL9");
ok("asphone webhook → inbound direction picks caller (from)", wh?.direction === "inbound" && wh?.otherNumber === "+919812345678");
ok("asphone webhook normalizes 00-prefix to +", wh?.otherNumber === "+919812345678");
ok("asphone webhook maps agent/status/duration/recording", wh?.agentExt === "101" && wh?.status === "answered" && wh?.durationSec === 42 && !!wh?.recordingUrl);
ok("asphone webhook epoch-seconds → Date", wh?.startedAt instanceof Date && wh!.startedAt!.getFullYear() === 2023);
ok("asphone webhook with no id → null (not a call event)", as.parseWebhook({ foo: "bar" }, cfg()) === null);
ok("asphone outbound picks destination (to)", as.parseWebhook({ call_id: "X", direction: "outbound", to: "+9715551234", from: "+97140000000" }, cfg())?.otherNumber === "+9715551234");

// ── AS Phone: webhook auth (HMAC + token) ─────────────────────────────────────
const raw = JSON.stringify({ call_id: "X" });
const sig = hmacHex(raw, "S3cr3t");
ok("valid HMAC passes", as.verifyWebhook({ token: null, signature: sig, rawBody: raw }, cfg()));
ok("valid HMAC with sha256= prefix passes", as.verifyWebhook({ token: null, signature: `sha256=${sig}`, rawBody: raw }, cfg()));
ok("wrong HMAC fails", !as.verifyWebhook({ token: null, signature: "deadbeef", rawBody: raw }, cfg()));
ok("token fallback passes when no secret set", as.verifyWebhook({ token: "TOK", signature: null, rawBody: raw }, cfg({ secret: null })));
ok("wrong token fails when no secret", !as.verifyWebhook({ token: "NOPE", signature: null, rawBody: raw }, cfg({ secret: null })));
ok("no secret + no token configured → allow (initial setup)", as.verifyWebhook({ token: null, signature: null, rawBody: raw }, cfg({ secret: null, webhookToken: null })));

// ── Acefone provider (legacy) ─────────────────────────────────────────────────
const ac = PROVIDERS.acefone;
const acReq = ac.buildClickToCall({ agentExt: "55", destinationNumber: "+9715551234", customIdentifier: "buyer:z" }, cfg({ provider: "acefone" }));
ok("acefone posts to /v1/click_to_call", acReq.url.endsWith("/v1/click_to_call"));
ok("acefone body uses agent_number/destination_number/custom_identifier", (() => { const b = JSON.parse(acReq.body!); return b.agent_number === "55" && b.destination_number === "+9715551234" && b.custom_identifier === "buyer:z"; })());
ok("acefone parses Success/Message", (() => { const r = ac.parseClickToCall(200, { Success: true, Message: "ok" }); return r.ok && r.message === "ok"; })());
ok("acefone webhook parses uuid + $-stripped fields", ac.parseWebhook({ uuid: "U1", direction: "outbound", call_to_number: "+9715551234", call_status: "ANSWER" }, cfg())?.providerCallId === "U1");

// ── Signature helpers ─────────────────────────────────────────────────────────
ok("safeEqual true for equal", safeEqual("abc", "abc"));
ok("safeEqual false for different length", !safeEqual("abc", "abcd"));
ok("verifyHmac false when secret missing", !verifyHmac(raw, null, sig));

// ── Normalization ─────────────────────────────────────────────────────────────
ok("normalizePhone adds +", normalizePhone("919812345678") === "+919812345678");
ok("normalizePhone 00 → +", normalizePhone("0097155123456") === "+97155123456");
ok("normalizePhone strips spaces/dashes", normalizePhone("+971 55-123 4567") === "+971551234567");
ok("normalizePhone rejects junk", normalizePhone("+") === null && normalizePhone("abc") === null);
ok("last10 returns trailing 10", last10("+919812345678") === "9812345678");
ok("pick returns first present", pick({ a: "", b: "hi" }, ["a", "b"]) === "hi");
ok("parseTs handles ISO", parseTs("2026-01-02T03:04:05Z")?.getUTCFullYear() === 2026);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);

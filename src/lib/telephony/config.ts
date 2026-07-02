import "server-only";
// Telephony config resolution — reads the credential placeholders from env.
//
// ┌─ WHEN YOU BUY AS PHONE NUMBERS, set these in Vercel → Settings → Env, redeploy.
// │  Nothing else changes; the whole integration lights up.
// │    TELEPHONY_PROVIDER   = asphone           (default; or "acefone")
// │    AS_PHONE_ACCOUNT_ID  = <account id>
// │    AS_PHONE_API_KEY     = <api key>
// │    AS_PHONE_SECRET      = <signing secret>  (webhook HMAC)
// │    AS_PHONE_BASE_URL    = <api base url>     (optional — provider default used if unset)
// │    AS_PHONE_DID         = <your DID/caller-id number>
// │    AS_PHONE_WEBHOOK_TOKEN = <random string>  (also appended to the webhook URL)
// └─ Back-compat: if TELEPHONY_PROVIDER is unset but ACEFONE_API_KEY exists, we
//    default to the existing Acefone provider so nothing regresses.

import type { TelephonyConfig } from "./types";

function env(k: string): string | null {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
}

/** Which provider is active. Explicit env wins; else infer from whichever creds exist. */
export function activeProvider(): string {
  const explicit = env("TELEPHONY_PROVIDER");
  if (explicit) return explicit.toLowerCase();
  if (env("ACEFONE_API_KEY")) return "acefone"; // legacy default
  return "asphone";
}

/** Resolve the config for the active provider, mapping legacy Acefone env when needed. */
export function telephonyConfig(): TelephonyConfig {
  const provider = activeProvider();
  if (provider === "acefone") {
    return {
      provider,
      accountId: env("ACEFONE_ACCOUNT_ID"),
      apiKey: env("ACEFONE_API_KEY"),
      secret: env("ACEFONE_WEBHOOK_TOKEN"), // acefone has no HMAC; token doubles as guard
      baseUrl: env("ACEFONE_BASE_URL"),
      didNumber: env("ACEFONE_DID_NUMBER"),
      webhookToken: env("ACEFONE_WEBHOOK_TOKEN"),
    };
  }
  // asphone (and any generic future provider) — the 5 first-class placeholders.
  return {
    provider,
    accountId: env("AS_PHONE_ACCOUNT_ID"),
    apiKey: env("AS_PHONE_API_KEY"),
    secret: env("AS_PHONE_SECRET"),
    baseUrl: env("AS_PHONE_BASE_URL"),
    didNumber: env("AS_PHONE_DID"),
    webhookToken: env("AS_PHONE_WEBHOOK_TOKEN"),
  };
}

/** Non-secret status for the admin console — never leaks the actual values. */
export function configStatus(cfg: TelephonyConfig): { key: string; label: string; set: boolean; required: boolean }[] {
  return [
    { key: "accountId", label: "Account ID", set: !!cfg.accountId, required: true },
    { key: "apiKey", label: "API Key", set: !!cfg.apiKey, required: true },
    { key: "secret", label: "Secret", set: !!cfg.secret, required: false },
    { key: "baseUrl", label: "Base URL", set: !!cfg.baseUrl, required: false },
    { key: "didNumber", label: "DID / Caller-ID", set: !!cfg.didNumber, required: true },
    { key: "webhookToken", label: "Webhook Token", set: !!cfg.webhookToken, required: false },
  ];
}

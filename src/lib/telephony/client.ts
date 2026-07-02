import "server-only";
// Outbound network side of the telephony layer. Pure request-building lives in the
// provider spec; this module performs the actual fetch + parse. Kept thin so the
// provider specs stay unit-testable without network.
import { telephonyConfig } from "./config";
import { providerSpec } from "./providers";
import type { ClickToCallParams, ClickToCallResult, NormalizedCallEvent } from "./types";

export function telephonyEnabled(): boolean {
  const cfg = telephonyConfig();
  return providerSpec(cfg.provider).isConfigured(cfg);
}

/** Which required credentials are still missing (for admin errors / console). */
export function telephonyMissing(): { provider: string; missing: string[] } {
  const cfg = telephonyConfig();
  return { provider: cfg.provider, missing: providerSpec(cfg.provider).missing(cfg) };
}

async function fetchJson(req: { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string }): Promise<{ status: number; json: unknown }> {
  const r = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
  const text = await r.text();
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

/** Fire an outbound click-to-call via the active provider. Returns quickly; the
 *  call lifecycle + recording arrive later via the webhook. */
export async function telephonyClickToCall(p: ClickToCallParams): Promise<ClickToCallResult> {
  const cfg = telephonyConfig();
  const spec = providerSpec(cfg.provider);
  if (!spec.isConfigured(cfg)) {
    return { ok: false, message: `${cfg.provider} not configured (missing: ${spec.missing(cfg).join(", ")})`, retryable: false };
  }
  try {
    const { status, json } = await fetchJson(spec.buildClickToCall(p, cfg));
    return spec.parseClickToCall(status, json);
  } catch (e) {
    // Network error → transient, worth retrying.
    return { ok: false, message: `Network error: ${String(e).slice(0, 200)}`, retryable: true };
  }
}

/** Pull recent calls from the provider (sync engine). Empty when unsupported. */
export async function telephonyListRecent(sinceISO: string): Promise<NormalizedCallEvent[]> {
  const cfg = telephonyConfig();
  const spec = providerSpec(cfg.provider);
  if (!spec.buildListRecent || !spec.parseListRecent || !spec.isConfigured(cfg)) return [];
  try {
    const { json } = await fetchJson(spec.buildListRecent(sinceISO, cfg));
    return spec.parseListRecent(json, cfg);
  } catch {
    return [];
  }
}

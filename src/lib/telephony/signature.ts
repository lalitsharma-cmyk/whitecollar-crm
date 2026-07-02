// Webhook authenticity helpers. Two independent guards, either sufficient:
//   1. Shared-secret token in the ?token= query (works for any provider, incl.
//      those that don't sign — e.g. Acefone).
//   2. HMAC-SHA256 of the raw body using the provider Secret, compared to the
//      provider's signature header (AS Phone and most modern providers).
import { createHmac, timingSafeEqual } from "crypto";

/** Constant-time string compare (avoids leaking length/among-equal via timing). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** HMAC-SHA256(rawBody, secret) as lowercase hex. */
export function hmacHex(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Verify an HMAC signature header. Accepts either a bare hex digest or the common
 * "sha256=<hex>" form. Returns false if secret or signature is missing.
 */
export function verifyHmac(rawBody: string, secret: string | null, signature: string | null): boolean {
  if (!secret || !signature) return false;
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return safeEqual(provided.toLowerCase(), hmacHex(rawBody, secret));
}

// Tiny signed-cookie session — works in Edge runtime (middleware) and Node.
// Format:  base64url(payload).base64url(hmac-sha256(payload, secret))
// payload = { uid: "...", exp: 1716543210 }

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(key: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return new Uint8Array(sig);
}

export type SessionPayload = { uid: string; exp: number };

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(enc.encode(json));
  const sigBytes = await hmac(secret, payloadB64);
  const sigB64 = b64urlEncode(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

export async function verifySession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  const expected = await hmac(secret, payloadB64);
  const got = b64urlDecode(sigB64);
  if (expected.length !== got.length) return null;
  let ok = 0;
  for (let i = 0; i < expected.length; i++) ok |= expected[i] ^ got[i];
  if (ok !== 0) return null;
  try {
    const payload = JSON.parse(dec.decode(b64urlDecode(payloadB64))) as SessionPayload;
    if (!payload.uid || !payload.exp) return null;
    if (Date.now() / 1000 > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "wcr_session";
export const SESSION_TTL_SECS = 60 * 60 * 24 * 30; // 30 days

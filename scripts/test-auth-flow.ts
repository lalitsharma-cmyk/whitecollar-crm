// Quick auth-flow verifier: generates a valid session cookie locally (using NEXTAUTH_SECRET
// from .env) for the admin user, then hits a protected PATCH endpoint to confirm whether
// the previous "Redirecting..." results were a curl/cookie artifact or a real proxy bug.
//
// Run: npx tsx scripts/test-auth-flow.ts <base-url>
// e.g. npx tsx scripts/test-auth-flow.ts https://crm.whitecollarrealty.com

import { PrismaClient } from "@prisma/client";

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = Buffer.from(bytes).toString("base64");
  return s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function hmac(key: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return new Uint8Array(sig);
}

async function signSession(payload: { uid: string; exp: number }, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = b64urlEncode(enc.encode(json));
  const sigBytes = await hmac(secret, payloadB64);
  const sigB64 = b64urlEncode(sigBytes);
  return `${payloadB64}.${sigB64}`;
}

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) { console.error("NEXTAUTH_SECRET missing"); process.exit(1); }

  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  if (!admin) { console.error("No admin user"); process.exit(1); }
  console.log(`Using admin: ${admin.email} (id=${admin.id})`);

  const token = await signSession({ uid: admin.id, exp: Math.floor(Date.now()/1000) + 3600 }, secret);
  console.log(`Generated token: ${token.slice(0, 32)}...`);

  // Pick a real lead to PATCH
  const lead = await prisma.lead.findFirst({ orderBy: { createdAt: "desc" } });
  if (!lead) { console.error("No leads in DB"); process.exit(1); }
  console.log(`Targeting lead: ${lead.id} (${lead.name})`);

  // 1. GET dashboard with our token
  const r1 = await fetch(`${baseUrl}/dashboard`, {
    headers: { Cookie: `wcr_session=${token}` },
    redirect: "manual",
  });
  console.log(`\n[GET /dashboard]  status=${r1.status}  type=${r1.headers.get("content-type")}`);

  // 2. PATCH inline-edit endpoint
  const r2 = await fetch(`${baseUrl}/api/leads/${lead.id}/update`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: `wcr_session=${token}` },
    body: JSON.stringify({ todoNext: `QA verify @ ${new Date().toISOString()}` }),
    redirect: "manual",
  });
  const t2 = await r2.text();
  console.log(`\n[PATCH /update]   status=${r2.status}`);
  console.log(`  body: ${t2.slice(0, 200)}`);

  // 3. POST log-call
  const r3 = await fetch(`${baseUrl}/api/leads/${lead.id}/log-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `wcr_session=${token}` },
    body: JSON.stringify({ outcome: "CONNECTED", durationSec: 45, remarks: "QA test call from auth-flow verifier" }),
    redirect: "manual",
  });
  const t3 = await r3.text();
  console.log(`\n[POST /log-call]  status=${r3.status}`);
  console.log(`  body: ${t3.slice(0, 200)}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

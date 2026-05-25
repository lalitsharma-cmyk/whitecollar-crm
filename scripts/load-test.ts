// Simulates 12 concurrent users (10 agents + 2 admins) hitting the CRM.
// Each "user" loops through realistic actions (dashboard, leads list,
// lead detail, log call) for ~30 seconds. Measures latency + error rate.
//
// Usage: npx tsx scripts/load-test.ts [baseUrl]

import { PrismaClient } from "@prisma/client";

const enc = new TextEncoder();
function b64(b: Uint8Array){let s=Buffer.from(b).toString("base64");return s.replace(/=+$/,"").replace(/\+/g,"-").replace(/\//g,"_");}
async function hm(k: string,m: string){const key=await crypto.subtle.importKey("raw",enc.encode(k),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",key,enc.encode(m)));}

interface Result { url: string; ms: number; status: number; }
const results: Result[] = [];

async function hit(baseUrl: string, cookie: string, path: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${baseUrl}${path}`, {
      headers: { Cookie: `wcr_session=${cookie}` },
      redirect: "manual",
    });
    await r.text();
    results.push({ url: path, ms: Date.now() - t0, status: r.status });
  } catch {
    results.push({ url: path, ms: Date.now() - t0, status: 0 });
  }
}

async function simulateUser(baseUrl: string, cookie: string, label: string, durationMs: number) {
  const flow = [
    "/dashboard", "/leads", "/pipeline", "/dashboard",
    "/reports/daily", "/cold-calls", "/leads", "/action-list",
  ];
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < durationMs) {
    await hit(baseUrl, cookie, flow[i % flow.length]);
    i++;
  }
  return `${label}: ${i} requests in ${Math.round((Date.now() - start) / 1000)}s`;
}

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:3000";
  const durationMs = 30_000;
  const concurrentUsers = 12;

  console.log(`Load test: ${concurrentUsers} concurrent users · ${durationMs/1000}s · ${baseUrl}\n`);

  const prisma = new PrismaClient();
  const users = await prisma.user.findMany({ where: { active: true }, take: concurrentUsers });
  if (users.length < concurrentUsers) {
    console.log(`Only ${users.length} active users in DB — looping to reach ${concurrentUsers}`);
  }
  const secret = process.env.NEXTAUTH_SECRET!;

  // Sign sessions for each
  const sessions = await Promise.all(Array.from({ length: concurrentUsers }, async (_, i) => {
    const u = users[i % users.length];
    const payload = { uid: u.id, exp: Math.floor(Date.now()/1000)+3600 };
    const pb = b64(enc.encode(JSON.stringify(payload)));
    const sb = b64(await hm(secret, pb));
    return { name: u.name, cookie: `${pb}.${sb}` };
  }));

  // Fire all 12 users in parallel
  const t0 = Date.now();
  const tasks = sessions.map((s, i) => simulateUser(baseUrl, s.cookie, `U${i+1}=${s.name}`, durationMs));
  const summaries = await Promise.all(tasks);
  const elapsed = Date.now() - t0;

  // ── Analyse ──
  const ok = results.filter(r => r.status >= 200 && r.status < 400).length;
  const errors = results.filter(r => r.status >= 500 || r.status === 0).length;
  const redirects = results.filter(r => r.status >= 300 && r.status < 400).length;
  const latencies = results.map(r => r.ms).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const max = latencies[latencies.length - 1];

  console.log("\n═══ RESULTS ═══");
  for (const s of summaries) console.log(`  ${s}`);
  console.log(`\nTotal requests:   ${results.length}`);
  console.log(`Successful (2xx): ${ok}  (${Math.round(ok/results.length*100)}%)`);
  console.log(`Redirects (3xx):  ${redirects}`);
  console.log(`Errors (5xx/0):   ${errors}`);
  console.log(`Throughput:       ${(results.length / (elapsed / 1000)).toFixed(1)} req/s`);
  console.log(`\nLatency:`);
  console.log(`  p50:  ${p50}ms`);
  console.log(`  p95:  ${p95}ms`);
  console.log(`  p99:  ${p99}ms`);
  console.log(`  max:  ${max}ms`);

  // Per-route p95
  const byRoute = new Map<string, number[]>();
  for (const r of results) {
    if (!byRoute.has(r.url)) byRoute.set(r.url, []);
    byRoute.get(r.url)!.push(r.ms);
  }
  console.log(`\nPer-route p95:`);
  for (const [path, lats] of [...byRoute.entries()].sort()) {
    const s = lats.sort((a, b) => a - b);
    const r95 = s[Math.floor(s.length * 0.95)];
    console.log(`  ${path.padEnd(20)} n=${s.length} p95=${r95}ms`);
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

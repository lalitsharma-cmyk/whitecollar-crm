import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

// Public health probe. Used to:
//   1. Confirm DB is reachable (SELECT 1 — a real round-trip to Postgres,
//      not just a process ping).
//   2. Verify *which* commit is live in production. The Vercel webhook has
//      historically silently dropped commits, so after every `npm run push`
//      we curl this endpoint and check `commit` matches `git rev-parse HEAD`.
//      Without this, the only way to tell is logging in & reading the dashboard
//      footer badge — which the cron jobs and CLI can't do.
//
// CONTRACT (deploy tooling): stays PUBLIC, and the JSON keys `ok`, `commit`,
// `ts` must keep their exact names/shape — scripts/deploy.sh verification and
// AGENTS.md grep for `"commit":"<sha>"`. Do not rename or nest them.
//
// SECURITY (audit P3/G1, fixed 2026-07-16): this used to return
// `leads: prisma.lead.count()` to ANY anonymous caller — the company's total
// lead count was public. The count is now returned ONLY to a logged-in user
// (optional-session check, same pattern as /api/logout); anonymous callers
// get the liveness fields only.
export async function GET() {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  try {
    // DB liveness without exposing table data.
    await prisma.$queryRaw`SELECT 1`;
    const base = { ok: true, commit, ts: new Date().toISOString() };
    // Optional session — .catch(() => null) so an auth-stack error can never
    // turn a healthy DB probe red (health must reflect DB + build only).
    const me = await getCurrentUser().catch(() => null);
    if (me) {
      const leads = await prisma.lead.count();
      return NextResponse.json({ ...base, leads });
    }
    return NextResponse.json(base);
  } catch (e) {
    return NextResponse.json({ ok: false, commit, error: String(e) }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public health probe. Used to:
//   1. Confirm DB is reachable (we count leads — a real query, not just a ping).
//   2. Verify *which* commit is live in production. The Vercel webhook has
//      historically silently dropped commits, so after every `npm run push`
//      we curl this endpoint and check `commit` matches `git rev-parse HEAD`.
//      Without this, the only way to tell is logging in & reading the dashboard
//      footer badge — which the cron jobs and CLI can't do.
export async function GET() {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);
  try {
    const t = await prisma.lead.count();
    return NextResponse.json({ ok: true, commit, leads: t, ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, commit, error: String(e) }, { status: 500 });
  }
}

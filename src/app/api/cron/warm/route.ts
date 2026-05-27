// FREE alternative to Neon Launch tier ($19/mo).
// A tiny pinger that runs every few minutes (set up via UptimeRobot or
// Hostmycode cron) to keep the Neon DB connection warm so it doesn't scale-to-zero.
// Public endpoint — no auth needed; doesn't reveal any data.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";

export async function GET() {
  const runId = await startCronRun("warm");
  try {
    // Trivial query just to keep the connection pool warm
    const t = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() as now`;
    await finishCronRun(runId, "OK");
    return NextResponse.json({ ok: true, now: t[0]?.now ?? new Date() });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

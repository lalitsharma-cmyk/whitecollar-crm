// Runs at 18:00 IST every day (cron: "30 12 * * *" — UTC).
// For each agent: find TODAY's follow-ups that were planned but NOT completed
// AND any HOT lead that still has no call logged today → notify + escalate to admin.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify, notifyRoles } from "@/lib/notify";
import { ActivityStatus, AIScore } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { startCronRun, finishCronRun } from "@/lib/cronRun";
import { runFollowupRollover } from "@/lib/followupRollover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function todayWindowIST() {
  const now = new Date();
  const istOffsetMin = 330;
  const istMs = now.getTime() + istOffsetMin * 60_000;
  const istDay = new Date(istMs); istDay.setUTCHours(0, 0, 0, 0);
  const startUTC = new Date(istDay.getTime() - istOffsetMin * 60_000);
  const endUTC = new Date(startUTC.getTime() + 24 * 3600_000);
  return { startUTC, endUTC, now };
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("evening-reminder");
  try {
  const { startUTC, now } = todayWindowIST();
  const agents = await prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } } });
  let notified = 0;
  const missesByAgent: Array<{ name: string; missed: number; uncalled: number }> = [];

  for (const u of agents) {
    // Missed: planned activity today, scheduledAt already past, status still PLANNED
    const missed = await prisma.activity.count({
      where: {
        userId: u.id,
        status: ActivityStatus.PLANNED,
        scheduledAt: { gte: startUTC, lte: now },
      },
    });
    // Hot leads owned by this agent with no call logged today at all
    const hotOwnedLeads = await prisma.lead.findMany({
      where: { ownerId: u.id, aiScore: AIScore.HOT, currentStatus: { notIn: SUPPRESSED_STATUSES }, deletedAt: null },
      include: { callLogs: { where: { startedAt: { gte: startUTC } }, take: 1 } },
    });
    const uncalled = hotOwnedLeads.filter((l) => l.callLogs.length === 0).length;

    if (missed === 0 && uncalled === 0) continue;

    const body = [
      missed > 0 ? `⏰ ${missed} follow-up${missed === 1 ? "" : "s"} you didn't get to today` : null,
      uncalled > 0 ? `🔥 ${uncalled} hot lead${uncalled === 1 ? "" : "s"} with no call today` : null,
    ].filter(Boolean).join(" · ");

    await notify({
      userId: u.id,
      kind: "REMINDER",
      severity: "WARNING",
      title: `🌙 EOD reminder — ${u.name.split(" ")[0]}`,
      body: `${body}. Quickly catch up or schedule for tomorrow before logging off.`,
      linkUrl: "/activities",
      email: true,
    });
    missesByAgent.push({ name: u.name, missed, uncalled });
    notified++;
  }

  // Roll up to Admin/Manager: how the team did today
  if (missesByAgent.length > 0) {
    const summary = missesByAgent.map((m) => `${m.name}: ${m.missed} missed, ${m.uncalled} hot uncalled`).join("\n");
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "REMINDER",
      severity: "WARNING",
      title: `📊 EOD team summary — ${missesByAgent.length} agent${missesByAgent.length === 1 ? "" : "s"} have unfinished work`,
      body: summary,
      linkUrl: "/dashboard",
      email: true,
    });
  }

  await finishCronRun(runId, "OK", undefined, { agentsNotified: notified });

  // ── Reliability: run the nightly follow-up rollover from HERE ──────────────
  // The GitHub-Actions schedule ("30 15 * * *" → /api/cron/followup-rollover) is
  // NOT firing (confirmed 2026-07-02: zero followup-rollover CronRun rows ever;
  // overdue piled up back to 26 Jun). This evening-reminder cron is Vercel-native
  // and DOES fire daily, so we run the rollover here as the reliable path — AFTER
  // the EOD reminders above, so agents are nudged about today's misses before the
  // roll moves them forward. Idempotent: if the GH job ever recovers, a 2nd same-
  // day run is a no-op (nothing left to move). Logged as its own run; a rollover
  // failure never fails the reminder cron.
  let rollover: Awaited<ReturnType<typeof runFollowupRollover>> | null = null;
  const rollId = await startCronRun("followup-rollover");
  try {
    rollover = await runFollowupRollover(new Date());
    await finishCronRun(rollId, "OK", undefined, { moved: rollover.moved, via: "evening-reminder" });
  } catch (e) {
    await finishCronRun(rollId, "ERROR", String(e));
  }

  return NextResponse.json({ ok: true, agentsNotified: notified, breakdown: missesByAgent, rollover });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

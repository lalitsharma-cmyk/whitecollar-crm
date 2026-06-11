// Runs at 10:00 IST every day (cron: "30 4 * * *" — UTC).
// For each agent, gathers TODAY's follow-ups + hot leads with no recent contact
// and creates one rolled-up notification → fires in-app + push + email.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { ActivityStatus, AIScore } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { syncProjectsFromMarketingSite } from "@/lib/syncProjects";
import { sendReportToManagers, windowsForToday } from "@/lib/reports";
import { quoteOneLine } from "@/lib/salesQuotes";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function todayWindowIST() {
  // 10:00 IST = 04:30 UTC. Cron triggers at 04:30 UTC.
  // "Today" runs from 00:00 IST → 23:59 IST = previous 18:30 UTC → next 18:29 UTC
  const now = new Date();
  const istOffsetMin = 330; // +05:30
  const istMs = now.getTime() + istOffsetMin * 60_000;
  const istDay = new Date(istMs); istDay.setUTCHours(0, 0, 0, 0);
  const startUTC = new Date(istDay.getTime() - istOffsetMin * 60_000);
  const endUTC = new Date(startUTC.getTime() + 24 * 3600_000);
  return { startUTC, endUTC };
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("morning-reminder");
  try {
  const { startUTC, endUTC } = todayWindowIST();

  // Per active agent: today's followups + hot leads that need attention
  const agents = await prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } } });
  let notified = 0;

  // One quote for everyone today (deterministic by day-of-year)
  const motivation = quoteOneLine();

  for (const u of agents) {
    const [followups, hot, newOvernight, callbacks] = await Promise.all([
      // ALL scheduled today (meetings + site visits + manual followups)
      prisma.activity.count({
        where: {
          userId: u.id,
          status: ActivityStatus.PLANNED,
          scheduledAt: { gte: startUTC, lte: endUTC },
        },
      }),
      // Hot leads needing attention
      prisma.lead.count({
        where: { ownerId: u.id, aiScore: AIScore.HOT, currentStatus: { notIn: SUPPRESSED_STATUSES }, deletedAt: null },
      }),
      // New leads assigned overnight (since the previous morning cron, i.e. last 24h)
      prisma.lead.count({
        where: {
          ownerId: u.id,
          createdAt: { gte: new Date(Date.now() - 24 * 3600_000) },
          deletedAt: null,
        },
      }),
      // Leads with followupDate set for TODAY — these are the "client asked me to call
      // back at this time" reminders Lalit asked for. Plus the 10-min-before push from
      // the new pre-meeting cron will catch the exact-time alert.
      prisma.lead.count({
        where: {
          ownerId: u.id,
          followupDate: { gte: startUTC, lte: endUTC },
          currentStatus: { notIn: SUPPRESSED_STATUSES },
          deletedAt: null,
        },
      }),
    ]);
    // Skip only when there is truly nothing — but always send the motivation line,
    // because nudging the agent into the app sets the tone for the day.
    if (followups === 0 && hot === 0 && newOvernight === 0 && callbacks === 0) {
      // Still send a thin "all clear" message so quote of the day reaches them.
      await notify({
        userId: u.id,
        kind: "REMINDER",
        severity: "INFO",
        title: `🌅 Good morning ${u.name.split(" ")[0]}`,
        body: `All clear — no follow-ups, no overnight leads. ${motivation}`,
        linkUrl: "/dashboard",
        email: false,  // skip email when there's no work to surface
      });
      notified++;
      continue;
    }

    const body = [
      newOvernight > 0 ? `🆕 ${newOvernight} new lead${newOvernight === 1 ? "" : "s"} since yesterday` : null,
      followups > 0 ? `📅 ${followups} follow-up${followups === 1 ? "" : "s"} due today` : null,
      callbacks > 0 ? `☎ ${callbacks} client callback${callbacks === 1 ? "" : "s"} scheduled` : null,
      hot > 0 ? `🔥 ${hot} hot lead${hot === 1 ? "" : "s"} need attention` : null,
    ].filter(Boolean).join(" · ");

    await notify({
      userId: u.id,
      kind: "REMINDER",
      severity: hot > 5 || newOvernight > 5 ? "WARNING" : "INFO",
      title: `🌅 Good morning ${u.name.split(" ")[0]} — your day`,
      body: `${body}\n\n${motivation}`,
      linkUrl: "/action-list",
      email: true,
    });
    notified++;
    // Note: We don't create an Activity here because Activity.leadId is required.
    // The notify() call above already records the reminder in Notification table.
  }

  // Opportunistic: resync projects from whitecollarrealty.com (best-effort)
  let projectSync: { upserted?: number; total?: number; error?: string } = {};
  try { projectSync = await syncProjectsFromMarketingSite(); }
  catch (e) { projectSync = { error: String(e) }; }

  // Auto-email reports to managers: daily always, weekly on Mondays, monthly on 1st
  const w = windowsForToday();
  const reports: Record<string, unknown> = {};
  try { reports.daily = await sendReportToManagers(w.daily); } catch (e) { reports.daily = { error: String(e) }; }
  if (w.isMonday) {
    try { reports.weekly = await sendReportToManagers(w.weekly); } catch (e) { reports.weekly = { error: String(e) }; }
  }
  if (w.isFirstOfMonth) {
    try { reports.monthly = await sendReportToManagers(w.monthly); } catch (e) { reports.monthly = { error: String(e) }; }
  }

  await finishCronRun(runId, "OK", undefined, { agentsNotified: notified });
  return NextResponse.json({ ok: true, agentsNotified: notified, window: { startUTC, endUTC }, projectSync, reports });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

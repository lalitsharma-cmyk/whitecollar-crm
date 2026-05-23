// Runs at 10:00 IST every day (cron: "30 4 * * *" — UTC).
// For each agent, gathers TODAY's follow-ups + hot leads with no recent contact
// and creates one rolled-up notification → fires in-app + push + email.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { ActivityType, ActivityStatus, AIScore } from "@prisma/client";
import { syncProjectsFromMarketingSite } from "@/lib/syncProjects";

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

  const { startUTC, endUTC } = todayWindowIST();

  // Per active agent: today's followups + hot leads that need attention
  const agents = await prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } } });
  let notified = 0;

  for (const u of agents) {
    const [followups, hot] = await Promise.all([
      prisma.activity.count({
        where: {
          userId: u.id,
          status: ActivityStatus.PLANNED,
          scheduledAt: { gte: startUTC, lte: endUTC },
        },
      }),
      prisma.lead.count({
        where: { ownerId: u.id, aiScore: AIScore.HOT, status: { notIn: ["WON", "LOST"] } },
      }),
    ]);
    if (followups === 0 && hot === 0) continue;

    const body = [
      followups > 0 ? `📅 ${followups} follow-up${followups === 1 ? "" : "s"} due today` : null,
      hot > 0 ? `🔥 ${hot} hot lead${hot === 1 ? "" : "s"} need attention` : null,
    ].filter(Boolean).join(" · ");

    await notify({
      userId: u.id,
      kind: "REMINDER",
      severity: hot > 5 ? "WARNING" : "INFO",
      title: `🌅 Good morning ${u.name.split(" ")[0]} — your day`,
      body,
      linkUrl: "/activities",
      email: true,
    });
    notified++;

    await prisma.activity.create({
      data: {
        leadId: undefined as unknown as string,  // not lead-scoped — system reminder
        userId: u.id,
        type: ActivityType.REMINDER_FIRED,
        status: ActivityStatus.DONE,
        title: "Morning briefing sent",
        description: body,
        completedAt: new Date(),
      },
    }).catch(() => {});  // skip if leadId required
  }

  // Opportunistic: resync projects from whitecollarrealty.com (best-effort, never fails the cron)
  let projectSync: { upserted?: number; total?: number; error?: string } = {};
  try { projectSync = await syncProjectsFromMarketingSite(); }
  catch (e) { projectSync = { error: String(e) }; }

  return NextResponse.json({ ok: true, agentsNotified: notified, window: { startUTC, endUTC }, projectSync });
}

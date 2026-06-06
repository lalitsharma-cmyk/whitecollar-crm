// Sunday-night weekly leaderboard digest.
//
// Cron: GitHub Actions fires this at 14:00 UTC Sunday = 19:30 IST / 18:00 GST.
// For every active ADMIN/MANAGER, computes the past-7-day leaderboards
// (mirroring /leaderboards/page.tsx query patterns) plus team totals,
// then emails the rolled-up HTML via the shared Resend helper.
//
// Auth: bearer CRON_SECRET — matches morning-reminder / rescore-all.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailEnabled } from "@/lib/email";
import { startCronRun, finishCronRun } from "@/lib/cronRun";
import { buildWeeklyDigestHtml, type DigestBoard, type DigestStats } from "@/lib/digestEmail";
import { ACTIVE_PURSUIT_STATUSES } from "@/lib/lead-statuses";
import {
  ActivityType,
  ActivityStatus,
  CallOutcome,
  Role,
} from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const runId = await startCronRun("weekly-digest");
  try {
    const now = new Date();
    // Rolling 7-day window — Sunday-to-Sunday in practice given the cron schedule.
    const weekStart = new Date(now.getTime() - 7 * 24 * 3600_000);

    // ── Eligible agents for the boards (active AGENT/MANAGER) ──
    const eligibleUsers = await prisma.user.findMany({
      where: { active: true, role: { in: [Role.AGENT, Role.MANAGER] } },
      select: { id: true, name: true },
    });
    const eligibleIds = eligibleUsers.map((u) => u.id);
    const nameById = new Map(eligibleUsers.map((u) => [u.id, u.name]));

    // ── Boards (re-uses the /leaderboards page query shapes) ──
    const [callsAgg, followupsAgg, totalsAgg, connectedAgg, coldAgg, siteVisitAgg] =
      await Promise.all([
        // Most calls
        prisma.callLog.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: { startedAt: { gte: weekStart }, userId: { in: eligibleIds } },
          orderBy: { _count: { userId: "desc" } },
          take: 5,
        }),
        // Most follow-ups completed
        prisma.activity.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: {
            type: ActivityType.TASK,
            status: ActivityStatus.DONE,
            completedAt: { gte: weekStart },
            userId: { in: eligibleIds },
          },
          orderBy: { _count: { userId: "desc" } },
          take: 5,
        }),
        // Connect-rate denominator
        prisma.callLog.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: { startedAt: { gte: weekStart }, userId: { in: eligibleIds } },
        }),
        // Connect-rate numerator
        prisma.callLog.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: {
            startedAt: { gte: weekStart },
            userId: { in: eligibleIds },
            outcome: CallOutcome.CONNECTED,
          },
        }),
        // Cold-to-warm
        prisma.activity.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: {
            type: ActivityType.COLD_TO_LEAD,
            completedAt: { gte: weekStart },
            userId: { in: eligibleIds },
          },
          orderBy: { _count: { userId: "desc" } },
          take: 5,
        }),
        // Site visits — done in the window
        prisma.activity.groupBy({
          by: ["userId"],
          _count: { _all: true },
          where: {
            type: ActivityType.SITE_VISIT,
            status: ActivityStatus.DONE,
            completedAt: { gte: weekStart },
            userId: { in: eligibleIds },
          },
          orderBy: { _count: { userId: "desc" } },
          take: 5,
        }),
      ]);

    const mostCalls: DigestBoard = {
      emoji: "📞",
      title: "Most calls",
      unit: "calls",
      rows: callsAgg
        .filter((c) => nameById.has(c.userId))
        .map((c) => ({ name: nameById.get(c.userId)!, value: c._count._all })),
    };

    // Connect-rate board — gated at min 5 calls so newcomers don't skew the chart.
    const connectedByUser = new Map(connectedAgg.map((c) => [c.userId, c._count._all]));
    const mostConnected: DigestBoard = {
      emoji: "📈",
      title: "Most connected (≥5 calls)",
      rows: totalsAgg
        .filter((t) => t._count._all >= 5 && nameById.has(t.userId))
        .map((t) => {
          const conn = connectedByUser.get(t.userId) ?? 0;
          const pct = (conn / t._count._all) * 100;
          return {
            name: nameById.get(t.userId)!,
            value: pct,
            display: `${pct.toFixed(1)}% (${conn}/${t._count._all})`,
          };
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    };

    const mostFollowups: DigestBoard = {
      emoji: "🎯",
      title: "Most follow-ups",
      unit: "tasks",
      rows: followupsAgg
        .filter((r) => r.userId && nameById.has(r.userId))
        .map((r) => ({ name: nameById.get(r.userId!)!, value: r._count._all })),
    };

    const coldToWarm: DigestBoard = {
      emoji: "🔥",
      title: "Cold-to-warm conversions",
      unit: "promoted",
      rows: coldAgg
        .filter((r) => r.userId && nameById.has(r.userId))
        .map((r) => ({ name: nameById.get(r.userId!)!, value: r._count._all })),
    };

    const siteVisits: DigestBoard = {
      emoji: "🏠",
      title: "Site visits",
      unit: "visits",
      rows: siteVisitAgg
        .filter((r) => r.userId && nameById.has(r.userId))
        .map((r) => ({ name: nameById.get(r.userId!)!, value: r._count._all })),
    };

    const boards: DigestBoard[] = [
      mostCalls,
      mostConnected,
      mostFollowups,
      coldToWarm,
      siteVisits,
    ];

    // ── Team totals over the window ──
    const [
      leadsCreated,
      callsMade,
      meetingsBooked,
      bookingsDone,
      openLeadsForPipeline,
    ] = await Promise.all([
      prisma.lead.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.callLog.count({ where: { startedAt: { gte: weekStart } } }),
      prisma.activity.count({
        where: {
          type: {
            in: [
              ActivityType.OFFICE_MEETING,
              ActivityType.VIRTUAL_MEETING,
              ActivityType.SITE_VISIT,
              ActivityType.HOME_VISIT,
              ActivityType.EXPO_MEETING,
              ActivityType.MEETING,
            ],
          },
          scheduledAt: { gte: weekStart },
        },
      }),
      // Bookings this week — leads marked "Booked with Us" (no stage system)
      prisma.lead.count({
        where: {
          currentStatus: "Booked with Us",
          updatedAt: { gte: weekStart },
        },
      }),
      // Pipeline snapshot — active-pursuit leads with budgets.
      prisma.lead.findMany({
        where: {
          currentStatus: { in: ACTIVE_PURSUIT_STATUSES },
          OR: [{ budgetMin: { not: null } }, { budgetMax: { not: null } }],
        },
        select: { budgetMin: true, budgetMax: true, budgetCurrency: true },
      }),
    ]);

    let pipelineAed = 0;
    let pipelineInr = 0;
    for (const lead of openLeadsForPipeline) {
      const lo = lead.budgetMin ?? lead.budgetMax ?? 0;
      const hi = lead.budgetMax ?? lead.budgetMin ?? 0;
      const mid = (lo + hi) / 2;
      if (!mid) continue;
      const ccy = (lead.budgetCurrency ?? "AED").toUpperCase();
      if (ccy === "INR") pipelineInr += mid;
      else pipelineAed += mid;
    }

    // ── Recipients: every active ADMIN + MANAGER with an email ──
    const recipients = await prisma.user.findMany({
      where: {
        active: true,
        role: { in: [Role.ADMIN, Role.MANAGER] },
        email: { not: "" },
      },
      select: { id: true, name: true, email: true },
    });

    const subject = `📊 Weekly leaderboard — week ending ${fmtDate(now)}`;
    const baseStats: Omit<DigestStats, "recipientName"> = {
      weekEnding: now,
      totals: {
        leadsCreated,
        callsMade,
        meetingsBooked,
        bookingsDone,
        pipelineAed,
        pipelineInr,
      },
      boards,
    };

    let sent = 0;
    let skipped = 0;
    const errors: Array<{ email: string; error: string }> = [];

    if (!emailEnabled()) {
      // Resend isn't wired up in dev — still log the run so we know the cron pinged.
      await finishCronRun(runId, "OK", undefined, {
        recipients: recipients.length,
        sent: 0,
        skipped: recipients.length,
        emailDisabled: true,
      });
      return NextResponse.json({
        ok: true,
        recipients: recipients.length,
        sent: 0,
        skipped: recipients.length,
        emailDisabled: true,
      });
    }

    for (const r of recipients) {
      if (!r.email) {
        skipped++;
        continue;
      }
      const html = buildWeeklyDigestHtml({ ...baseStats, recipientName: r.name });
      const result = await sendEmail({ to: r.email, subject, html });
      if (result.ok) sent++;
      else {
        skipped++;
        errors.push({ email: r.email, error: result.error ?? "unknown" });
      }
    }

    await finishCronRun(runId, "OK", undefined, {
      recipients: recipients.length,
      sent,
      skipped,
      errorCount: errors.length,
    });
    return NextResponse.json({
      ok: true,
      recipients: recipients.length,
      sent,
      skipped,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    throw e;
  }
}

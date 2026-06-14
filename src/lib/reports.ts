import { prisma } from "@/lib/prisma";
import { sendEmail, emailTemplate, emailEnabled } from "@/lib/email";
import { fmtMoney } from "@/lib/money";
import { LeadSource, LeadStatus, AIScore, CallOutcome } from "@prisma/client";
import { BOOKED_STATUSES } from "@/lib/lead-statuses";

interface Window { since: Date; until: Date; label: string; }

export async function buildReport(win: Window) {
  const [totalNew, hot, won, lost, calls, connected, agentTable, sourceTable, aedSum, inrSum] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: win.since, lte: win.until } } }),
    prisma.lead.count({ where: { aiScore: AIScore.HOT, createdAt: { gte: win.since, lte: win.until } } }),
    prisma.lead.count({ where: { currentStatus: { in: BOOKED_STATUSES }, deletedAt: null, updatedAt: { gte: win.since, lte: win.until } } }),
    prisma.lead.count({ where: { status: LeadStatus.LOST, updatedAt: { gte: win.since, lte: win.until } } }),
    prisma.callLog.count({ where: { startedAt: { gte: win.since, lte: win.until } } }),
    prisma.callLog.count({ where: { startedAt: { gte: win.since, lte: win.until }, outcome: CallOutcome.CONNECTED } }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
      include: { _count: { select: { callLogs: { where: { startedAt: { gte: win.since, lte: win.until } } }, ownedLeads: true } } },
    }),
    prisma.lead.groupBy({ by: ["source"], where: { createdAt: { gte: win.since, lte: win.until } }, _count: { _all: true } }),
    prisma.lead.aggregate({ where: { budgetCurrency: "AED", createdAt: { gte: win.since, lte: win.until } }, _sum: { budgetMin: true } }),
    prisma.lead.aggregate({ where: { budgetCurrency: "INR", createdAt: { gte: win.since, lte: win.until } }, _sum: { budgetMin: true } }),
  ]);

  const connectRate = calls ? Math.round((connected / calls) * 100) : 0;
  const conversionRate = totalNew ? ((won / totalNew) * 100).toFixed(1) : "0";

  const lines: string[] = [
    `📈 ${win.label} report`,
    ``,
    `Leads created: ${totalNew} (${hot} hot)`,
    `Won: ${won}  ·  Lost: ${lost}  ·  Conversion: ${conversionRate}%`,
    `Calls: ${calls}  ·  Connected: ${connected} (${connectRate}%)`,
    `Pipeline added: ${fmtMoney(aedSum._sum.budgetMin ?? 0, "AED")} + ${fmtMoney(inrSum._sum.budgetMin ?? 0, "INR")}`,
    ``,
    `Agent leaderboard:`,
    ...agentTable
      .sort((a, b) => b._count.callLogs - a._count.callLogs)
      .map((u) => `  ${u.name.padEnd(20)} ${u._count.callLogs} calls, ${u._count.ownedLeads} active leads`),
    ``,
    `Source breakdown:`,
    ...sourceTable.map((s) => `  ${s.source.padEnd(20)} ${s._count._all}`),
  ];

  return { body: lines.join("\n"), totals: { totalNew, hot, won, lost, calls, connected, connectRate, conversionRate } };
}

export async function sendReportToManagers(win: Window) {
  const report = await buildReport(win);
  if (!emailEnabled()) return { ok: false, reason: "email-not-configured" };
  const recipients = await prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { email: true, name: true },
  });
  let sent = 0;
  for (const r of recipients) {
    const html = emailTemplate({
      title: `📊 ${win.label} report`,
      body: report.body,
      ctaUrl: `${process.env.NEXTAUTH_URL ?? "https://crm.whitecollarrealty.com"}/reports`,
      ctaLabel: "Open Reports",
    });
    const res = await sendEmail({ to: r.email, subject: `[WCR CRM] ${win.label} report`, html });
    if (res.ok) sent++;
  }
  return { ok: true, sent, recipients: recipients.length };
}

// Compute today / this-week / this-month windows in IST
export function windowsForToday(now = new Date()) {
  const istOffsetMin = 330;
  const istMs = now.getTime() + istOffsetMin * 60_000;
  const istNow = new Date(istMs);

  // Today (IST)
  const todayStartIST = new Date(istNow); todayStartIST.setUTCHours(0, 0, 0, 0);
  const startUTC = (d: Date) => new Date(d.getTime() - istOffsetMin * 60_000);
  const daily = { since: startUTC(todayStartIST), until: now, label: "Daily" };

  // This week (IST, Mon-Sun)
  const day = istNow.getUTCDay(); // 0 = Sun
  const daysFromMonday = (day + 6) % 7;
  const mondayIST = new Date(istNow); mondayIST.setUTCDate(istNow.getUTCDate() - daysFromMonday); mondayIST.setUTCHours(0,0,0,0);
  const weekly = { since: startUTC(mondayIST), until: now, label: "Weekly" };

  // This month
  const monthStartIST = new Date(istNow); monthStartIST.setUTCDate(1); monthStartIST.setUTCHours(0,0,0,0);
  const monthly = { since: startUTC(monthStartIST), until: now, label: "Monthly" };

  return { daily, weekly, monthly, isMonday: daysFromMonday === 0, isFirstOfMonth: istNow.getUTCDate() === 1 };
}

import { prisma } from "@/lib/prisma";
import { sendEmail, emailTemplate, emailEnabled } from "@/lib/email";
import { fmtMoney } from "@/lib/money";
import { AIScore, CallOutcome } from "@prisma/client";
import { BOOKED_STATUSES, LOST_STATUSES } from "@/lib/lead-statuses";
import { activeLeadWhere } from "@/lib/leadScope";
import { effectiveSource } from "@/lib/sourceLabel";
import { excludePendingCallsWhere } from "@/lib/ghosting";

interface Window { since: Date; until: Date; label: string; }

export async function buildReport(win: Window) {
  const [totalNew, hot, won, lost, calls, connected, agentTable, sourceRows, aedSum, inrSum] = await Promise.all([
    // deletedAt: null on every Lead query — recycle-bin records never count in reports/analytics.
    prisma.lead.count({ where: { deletedAt: null, createdAt: { gte: win.since, lte: win.until } } }),
    prisma.lead.count({ where: { deletedAt: null, aiScore: AIScore.HOT, createdAt: { gte: win.since, lte: win.until } } }),
    // Won = booked (currentStatus ∈ BOOKED_STATUSES — the canonical win set, NOT the
    // dead `status` WON enum which never advances). Lost = currentStatus ∈ LOST_STATUSES
    // (was the DEAD `status: LOST` enum → reported 3 vs the real ~175). Managers are
    // emailed these numbers, so both key off the real MIS currentStatus vocabulary.
    prisma.lead.count({ where: { currentStatus: { in: BOOKED_STATUSES }, deletedAt: null, updatedAt: { gte: win.since, lte: win.until } } }),
    prisma.lead.count({ where: { deletedAt: null, currentStatus: { in: LOST_STATUSES }, updatedAt: { gte: win.since, lte: win.until } } }),
    // excludePendingCallsWhere() drops unresolved dials (INITIATED / RINGING) — a
    // CallLog row is written the INSTANT "Call" is tapped. `calls` is the connectRate
    // DENOMINATOR below, so leaving it open would both inflate "Calls:" and silently
    // depress the connect rate managers are emailed. The `connected` line is an
    // allow-list (outcome: CONNECTED) and is immune to pending rows by construction.
    prisma.callLog.count({ where: { ...excludePendingCallsWhere(), startedAt: { gte: win.since, lte: win.until } } }),
    prisma.callLog.count({ where: { startedAt: { gte: win.since, lte: win.until }, outcome: CallOutcome.CONNECTED } }),
    prisma.user.findMany({
      where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
      // "active leads" in the manager digest must mean the SAME thing as everywhere
      // else — the canonical active set (non-terminal, ACTIVE origin, not deleted).
      // A raw ownedLeads count would over-count (booked/lost/cold) and mismatch the
      // leaderboard/team/agent-performance numbers (audit 2026-06-27).
      // Leaderboard call counts carry the SAME pending guard as the `calls` total
      // above — otherwise the per-agent "N calls" rows would out-sum the "Calls:"
      // headline in the very same email as unresolved dials accumulate.
      include: { _count: { select: { callLogs: { where: { ...excludePendingCallsWhere(), startedAt: { gte: win.since, lte: win.until } } }, ownedLeads: { where: activeLeadWhere() } } } },
    }),
    // Source breakdown reads VERBATIM sourceRaw (enum label only as legacy fallback)
    // so analytics show the real channel ("Townscript"), never corrupted "CSV_IMPORT".
    // Grouped in JS below because the key is a coalesce of sourceRaw/source.
    prisma.lead.findMany({ where: { deletedAt: null, createdAt: { gte: win.since, lte: win.until } }, select: { source: true, sourceRaw: true } }),
    prisma.lead.aggregate({ where: { deletedAt: null, budgetCurrency: "AED", createdAt: { gte: win.since, lte: win.until } }, _sum: { budgetMin: true } }),
    prisma.lead.aggregate({ where: { deletedAt: null, budgetCurrency: "INR", createdAt: { gte: win.since, lte: win.until } }, _sum: { budgetMin: true } }),
  ]);

  // Group source breakdown by EFFECTIVE source (verbatim sourceRaw, else enum label).
  const sourceCounts = new Map<string, number>();
  for (const r of sourceRows) {
    const key = effectiveSource(r.sourceRaw, r.source);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
  }
  const sourceTable = [...sourceCounts.entries()].map(([source, n]) => ({ source, n })).sort((a, b) => b.n - a.n);

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
    ...sourceTable.map((s) => `  ${s.source.padEnd(20)} ${s.n}`),
  ];

  return { body: lines.join("\n"), totals: { totalNew, hot, won, lost, calls, connected, connectRate, conversionRate } };
}

export async function sendReportToManagers(win: Window) {
  const report = await buildReport(win);
  if (!emailEnabled()) return { ok: false, reason: "email-not-configured" };
  const recipients = await prisma.user.findMany({
    where: { active: true, hrOnly: false, role: { in: ["ADMIN", "MANAGER"] } },
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

// Daily summary PDF — admin/manager downloads a one-page A4 brief covering
// the team's (or one agent's) numbers for the chosen IST day.
//
// Mirrors what /reports/daily shows, but rolled up across all agents the
// caller can scope to. Uses pdfkit (same lib as the CMA generator at
// src/lib/cmaPdf.ts) so we don't add a new npm dependency.
import { type NextRequest } from "next/server";
import PDFDocument from "pdfkit";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ActivityType, LeadStatus, CallOutcome } from "@prisma/client";
import { audit, reqMeta } from "@/lib/audit";
import { fmtMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

// Brand palette — matches cmaPdf
const NAVY = "#0b1a33";
const GOLD = "#c9a24b";
const INK  = "#0b1a33";
const MUTED = "#6b7280";

const IST_OFFSET_MIN = 330; // +05:30

/** Start of IST day for `YYYY-MM-DD` (string) or "today" (omitted) — returned as a UTC Date. */
function istDayWindow(dateStr: string | null): { start: Date; end: Date; label: string } {
  // If no date, derive today's IST date
  let y: number, m: number, d: number;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  } else {
    const nowIstMs = Date.now() + IST_OFFSET_MIN * 60_000;
    const iso = new Date(nowIstMs).toISOString().slice(0, 10);
    [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  }
  // IST midnight = UTC (prev day) 18:30
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - IST_OFFSET_MIN * 60_000;
  const endUtcMs   = startUtcMs + 24 * 3600 * 1000 - 1;
  const label = `${String(d).padStart(2, "0")}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1]}-${y}`;
  return { start: new Date(startUtcMs), end: new Date(endUtcMs), label };
}

export async function GET(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const teamParam = url.searchParams.get("team");      // "Dubai" | "India" | "all" | null
  const agentParam = url.searchParams.get("agent");    // single user id, optional

  const { start: dayStart, end: dayEnd, label: dayLabel } = istDayWindow(dateParam);

  // ── Build agent scope ───────────────────────────────────────────────
  // - explicit ?agent= wins
  // - else ?team= filters User.team
  // - manager (not admin) is implicitly limited to their direct reports + self
  const userWhere: { active: boolean; team?: string; id?: string | { in: string[] } } = { active: true };
  if (teamParam && teamParam !== "all") userWhere.team = teamParam;
  if (agentParam) userWhere.id = agentParam;
  if (me.role === "MANAGER" && !agentParam) {
    const reports = await prisma.user.findMany({
      where: { managerId: me.id, active: true },
      select: { id: true },
    });
    userWhere.id = { in: [me.id, ...reports.map((r) => r.id)] };
  }

  const scopedUsers = await prisma.user.findMany({
    where: userWhere,
    select: { id: true, name: true, team: true },
    orderBy: { name: "asc" },
  });
  const scopedUserIds = scopedUsers.map((u) => u.id);

  // No users in scope → still render an empty report rather than 404
  const userIdFilter = scopedUserIds.length > 0 ? { in: scopedUserIds } : { in: ["__none__"] };

  // ── Aggregate the 8 KPIs ────────────────────────────────────────────
  const [
    leadsCreated,
    callsMade,
    callsConnected,
    followupsDone,
    meetingsBooked,
    siteVisits,
    bookingsDone,
    wonLeads,
    perAgentCalls,
    perAgentConnected,
    perAgentMeetings,
    perAgentFollowups,
  ] = await Promise.all([
    // Leads created today, owned by an in-scope agent
    prisma.lead.count({ where: { ownerId: userIdFilter, createdAt: { gte: dayStart, lte: dayEnd } } }),
    // Calls made today by in-scope agent
    prisma.callLog.count({ where: { userId: userIdFilter, startedAt: { gte: dayStart, lte: dayEnd } } }),
    // Connected calls
    prisma.callLog.count({ where: { userId: userIdFilter, startedAt: { gte: dayStart, lte: dayEnd }, outcome: CallOutcome.CONNECTED } }),
    // Follow-ups completed = any non-meeting activity completed today
    prisma.activity.count({ where: {
      userId: userIdFilter,
      completedAt: { gte: dayStart, lte: dayEnd },
      type: { in: [ActivityType.CALL, ActivityType.WHATSAPP, ActivityType.EMAIL, ActivityType.TASK, ActivityType.BROCHURE_SENT] },
    } }),
    // Meetings booked = office / virtual / expo meetings scheduled today
    prisma.activity.count({ where: {
      userId: userIdFilter,
      scheduledAt: { gte: dayStart, lte: dayEnd },
      type: { in: [ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.EXPO_MEETING] },
    } }),
    // Site visits done today (completed, includes home_visit for IN team)
    prisma.activity.count({ where: {
      userId: userIdFilter,
      completedAt: { gte: dayStart, lte: dayEnd },
      type: { in: [ActivityType.SITE_VISIT, ActivityType.HOME_VISIT] },
    } }),
    // Bookings done = leads moved into BOOKING_DONE today
    prisma.lead.count({ where: {
      ownerId: userIdFilter,
      status: LeadStatus.BOOKING_DONE,
      updatedAt: { gte: dayStart, lte: dayEnd },
    } }),
    // Won leads → for AED + INR pipeline value
    prisma.lead.findMany({
      where: { ownerId: userIdFilter, status: LeadStatus.WON, updatedAt: { gte: dayStart, lte: dayEnd } },
      select: { budgetMin: true, budgetCurrency: true },
    }),
    // Per-agent breakdowns
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { userId: userIdFilter, startedAt: { gte: dayStart, lte: dayEnd } },
      _count: { _all: true },
    }),
    prisma.callLog.groupBy({
      by: ["userId"],
      where: { userId: userIdFilter, startedAt: { gte: dayStart, lte: dayEnd }, outcome: CallOutcome.CONNECTED },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: {
        userId: userIdFilter,
        scheduledAt: { gte: dayStart, lte: dayEnd },
        type: { in: [ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.EXPO_MEETING, ActivityType.SITE_VISIT, ActivityType.HOME_VISIT] },
      },
      _count: { _all: true },
    }),
    prisma.activity.groupBy({
      by: ["userId"],
      where: {
        userId: userIdFilter,
        completedAt: { gte: dayStart, lte: dayEnd },
        type: { in: [ActivityType.CALL, ActivityType.WHATSAPP, ActivityType.EMAIL, ActivityType.TASK, ActivityType.BROCHURE_SENT] },
      },
      _count: { _all: true },
    }),
  ]);

  const revenueAed = wonLeads.filter((d) => (d.budgetCurrency ?? "AED") === "AED").reduce((s, d) => s + (d.budgetMin ?? 0), 0);
  const revenueInr = wonLeads.filter((d) => d.budgetCurrency === "INR").reduce((s, d) => s + (d.budgetMin ?? 0), 0);

  // Build per-agent lookup tables
  const lookup = (rows: { userId: string | null; _count: { _all: number } }[]) =>
    Object.fromEntries(rows.filter((r) => r.userId).map((r) => [r.userId!, r._count._all]));
  const callsByAgent = lookup(perAgentCalls);
  const connByAgent = lookup(perAgentConnected);
  const meetByAgent = lookup(perAgentMeetings);
  const fuByAgent = lookup(perAgentFollowups);

  // ── Build PDF ───────────────────────────────────────────────────────
  const teamLabel = agentParam
    ? (scopedUsers[0]?.name ?? "Agent")
    : (teamParam && teamParam !== "all" ? `${teamParam} team` : "All teams");

  const pdfBuf = await renderDailyPdf({
    dayLabel,
    teamLabel,
    isPerAgent: !!agentParam,
    kpis: {
      leadsCreated,
      callsMade,
      callsConnected,
      followupsDone,
      meetingsBooked,
      siteVisits,
      bookingsDone,
      revenueAed,
      revenueInr,
    },
    agents: scopedUsers.map((u) => ({
      name: u.name,
      team: u.team ?? "",
      calls: callsByAgent[u.id] ?? 0,
      connected: connByAgent[u.id] ?? 0,
      meetings: meetByAgent[u.id] ?? 0,
      followups: fuByAgent[u.id] ?? 0,
    })),
  });

  // Audit
  await audit({
    userId: me.id,
    action: "report.daily.pdf",
    entity: "Report",
    meta: { date: dayLabel, team: teamParam ?? "all", agent: agentParam ?? null, agentCount: scopedUsers.length },
    request: reqMeta(req),
  });

  const teamSlug = (teamParam ?? "all").toLowerCase();
  const dateSlug = (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam))
    ? dateParam
    : new Date(Date.now() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
  const filename = `wcr-daily-${dateSlug}-${teamSlug}.pdf`;

  return new Response(new Uint8Array(pdfBuf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBuf.length),
    },
  });
}

// ── PDF renderer ─────────────────────────────────────────────────────

interface DailyPdfInput {
  dayLabel: string;
  teamLabel: string;
  isPerAgent: boolean;
  kpis: {
    leadsCreated: number;
    callsMade: number;
    callsConnected: number;
    followupsDone: number;
    meetingsBooked: number;
    siteVisits: number;
    bookingsDone: number;
    revenueAed: number;
    revenueInr: number;
  };
  agents: { name: string; team: string; calls: number; connected: number; meetings: number; followups: number }[];
}

async function renderDailyPdf(input: DailyPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: {
    Title: `White Collar Realty — Daily Report ${input.dayLabel}`,
    Author: "White Collar Realty CRM",
    Subject: "Daily sales summary",
  }});

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const endPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // ── Letterhead (gold band + brand) ──
  doc.rect(0, 0, pageW, 60).fill(NAVY);
  doc.rect(0, 60, pageW, 6).fill(GOLD);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(20).text("WHITE COLLAR REALTY", 40, 22);
  doc.fillColor(GOLD).font("Helvetica").fontSize(9).text("Daily Sales Brief", pageW - 160, 32, { width: 120, align: "right" });

  // ── Title + subtitle ──
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(18).text(`Daily Report — ${input.dayLabel}`, 40, 90);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(`Scope: ${input.teamLabel}`, 40, 115);

  // ── 8-tile KPI grid (4 cols × 2 rows) ──
  const tiles: { label: string; value: string }[] = [
    { label: "Leads created",    value: String(input.kpis.leadsCreated) },
    { label: "Calls made",       value: String(input.kpis.callsMade) },
    { label: "Connected",        value: String(input.kpis.callsConnected) },
    { label: "Follow-ups done",  value: String(input.kpis.followupsDone) },
    { label: "Meetings booked",  value: String(input.kpis.meetingsBooked) },
    { label: "Site visits",      value: String(input.kpis.siteVisits) },
    { label: "Bookings done",    value: String(input.kpis.bookingsDone) },
    { label: "Pipeline value",   value: pipelineValue(input.kpis.revenueAed, input.kpis.revenueInr) },
  ];

  const gridY = 145;
  const cols = 4;
  const gutter = 10;
  const tileW = (pageW - 80 - gutter * (cols - 1)) / cols;
  const tileH = 70;
  tiles.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = 40 + col * (tileW + gutter);
    const y = gridY + row * (tileH + gutter);
    doc.roundedRect(x, y, tileW, tileH, 6).fillAndStroke("#f8fafc", "#e5e7eb");
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(t.label.toUpperCase(), x + 10, y + 10, { width: tileW - 20 });
    // Shrink font if value is long (e.g. dual currency string)
    const valSize = t.value.length > 14 ? 12 : t.value.length > 8 ? 16 : 22;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(valSize).text(t.value, x + 10, y + 28, { width: tileW - 20, ellipsis: true });
  });

  // ── Per-agent table (only when no specific agent filter) ──
  if (!input.isPerAgent) {
    const tableY = gridY + 2 * (tileH + gutter) + 20;
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(13).text("Per-agent breakdown", 40, tableY);
    doc.moveTo(40, tableY + 20).lineTo(110, tableY + 20).lineWidth(2).strokeColor(GOLD).stroke();

    const cols2 = [
      { header: "Agent",       width: 160, align: "left"   as const },
      { header: "Team",        width: 70,  align: "left"   as const },
      { header: "Calls",       width: 60,  align: "right"  as const },
      { header: "Connected",   width: 75,  align: "right"  as const },
      { header: "Meetings",    width: 70,  align: "right"  as const },
      { header: "Follow-ups",  width: 75,  align: "right"  as const },
    ];

    let y = tableY + 32;
    // Header row
    doc.rect(40, y, pageW - 80, 20).fill("#0b1a33");
    let cx = 40 + 8;
    for (const c of cols2) {
      doc.fillColor("white").font("Helvetica-Bold").fontSize(9).text(c.header, cx, y + 6, { width: c.width - 10, align: c.align });
      cx += c.width;
    }
    y += 20;

    // Body
    const maxRows = Math.floor((pageH - 80 - y) / 18);
    const visible = input.agents.slice(0, maxRows);
    visible.forEach((a, i) => {
      if (i % 2 === 0) doc.rect(40, y, pageW - 80, 18).fill("#fafafa");
      cx = 40 + 8;
      const values = [a.name, a.team, String(a.calls), String(a.connected), String(a.meetings), String(a.followups)];
      values.forEach((v, j) => {
        doc.fillColor(INK).font("Helvetica").fontSize(9).text(v, cx, y + 5, { width: cols2[j].width - 10, align: cols2[j].align, ellipsis: true });
        cx += cols2[j].width;
      });
      y += 18;
    });

    if (visible.length === 0) {
      doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(10).text("No agents in scope.", 40, y + 6);
    } else if (input.agents.length > visible.length) {
      doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8)
        .text(`(${input.agents.length - visible.length} more agents truncated)`, 40, y + 4);
    }
  }

  // ── Footer ──
  const footerY = pageH - 40;
  doc.moveTo(40, footerY - 6).lineTo(pageW - 40, footerY - 6).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
  const generatedAt = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(new Date());
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`Generated ${generatedAt} IST`, 40, footerY, { width: 250, align: "left" });
  doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(8).text("Confidential — internal use only", pageW - 290, footerY, { width: 250, align: "right" });

  doc.end();
  return endPromise;
}

function pipelineValue(aed: number, inr: number): string {
  if (aed === 0 && inr === 0) return "—";
  const parts: string[] = [];
  if (aed > 0) parts.push(fmtMoney(aed, "AED"));
  if (inr > 0) parts.push(fmtMoney(inr, "INR"));
  return parts.join(" + ");
}

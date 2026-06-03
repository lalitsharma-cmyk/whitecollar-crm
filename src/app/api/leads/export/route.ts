import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import { LeadStatus, LeadSource, AIScore, Potential, Prisma } from "@prisma/client";

// CSV export for the leads list — available to any logged-in user.
// Results are scoped via leadScopeWhere so each role sees only what they
// are allowed to see (same as /leads page). Supports the same filter params.

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Per RFC 4180: wrap in double-quotes if value contains comma, quote, CR or LF.
  // Escape embedded double-quotes by doubling them.
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toDate(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  // Auth — any logged-in user (role-scoped via leadScopeWhere below)
  const me = await getCurrentUser();
  if (!me) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries()) as Record<string, string | undefined>;

  // ── Scope + filter (mirrors /leads/page.tsx logic) ─────────────────────
  const scope = await leadScopeWhere(me);
  const where: Prisma.LeadWhereInput = sp.showCold === "1"
    ? { ...scope }
    : { ...scope, isColdCall: false, leadOrigin: "ACTIVE" };

  // Pipeline filter tab (?filter=)
  const filterTab = sp.filter ?? "all";
  if (filterTab === "active") {
    where.status = { notIn: [LeadStatus.WON, LeadStatus.LOST, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "bookings") {
    where.status = { in: [LeadStatus.EOI, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "won") {
    where.status = { in: [LeadStatus.WON, LeadStatus.BOOKING_DONE] };
  } else if (filterTab === "lost") {
    where.status = LeadStatus.LOST;
  }

  // Agents: hide LOST by default (same guard as the page)
  if (me.role === "AGENT" && !sp.status && filterTab === "all") {
    where.status = { not: LeadStatus.LOST };
  }

  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { phone: { contains: sp.q } },
      { email: { contains: sp.q, mode: "insensitive" } },
      { company: { contains: sp.q, mode: "insensitive" } },
    ];
  }

  if (sp.status) where.status = sp.status as LeadStatus;
  if (sp.ai) where.aiScore = sp.ai as AIScore;
  if (sp.team) where.forwardedTeam = sp.team;

  // Agents cannot filter by owner (same guard as the page)
  if (me.role !== "AGENT") {
    if (sp.owner === "unassigned") where.ownerId = null;
    else if (sp.owner) where.ownerId = sp.owner;
  }

  // Agents cannot filter by source
  if (sp.source && me.role !== "AGENT") {
    where.source = sp.source as LeadSource;
  }

  if (sp.potential) where.potential = sp.potential as Potential;

  if (sp.when === "24h") where.createdAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };
  else if (sp.when === "7d") where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
  else if (sp.when === "30d") where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
  else if (sp.when === "overdue") where.lastTouchedAt = { lt: new Date(Date.now() - 5 * 24 * 3600 * 1000) };

  // EOI filters
  if (sp.eoi === "active") where.eoiStage = { not: null };
  else if (sp.eoi === "kyc_pending") where.kycStatus = "PENDING";
  else if (sp.eoi === "approval_needed") where.eoiApprovalRequired = true;
  else if (sp.eoi === "stuck") {
    where.bookingDoneAt = null;
    where.eoiCollectedAt = { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000), not: null };
  }

  // Not-picked filter
  const notPickedDays = sp.notPicked ? parseInt(sp.notPicked) : null;
  if (notPickedDays && [2, 3, 5, 7, 14].includes(notPickedDays)) {
    const since = new Date(Date.now() - notPickedDays * 24 * 3600 * 1000);
    where.callLogs = {
      some: {
        outcome: { in: ["NOT_PICKED", "SWITCHED_OFF", "BUSY"] },
        startedAt: { gte: since },
      },
      none: {
        outcome: { in: ["CONNECTED", "INTERESTED"] },
        startedAt: { gte: since },
      },
    };
  }

  // Follow-up date filter — mirrors the IST-aware logic from the page
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const nowISTBoundary = new Date(Date.now() + IST_OFFSET_MS);
  const istMidnight = new Date(nowISTBoundary);
  istMidnight.setUTCHours(0, 0, 0, 0);
  const istWindow = (offsetDays: number) => {
    const start = new Date(istMidnight);
    start.setUTCDate(start.getUTCDate() + offsetDays);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      gte: new Date(start.getTime() - IST_OFFSET_MS),
      lt: new Date(end.getTime() - IST_OFFSET_MS),
    };
  };

  const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.owner || sp.team || sp.score || sp.notPicked || sp.eoi);
  const effectiveFollowup = sp.followup ?? (hasOtherFilter ? "all" : "today");

  if (effectiveFollowup === "today") {
    where.followupDate = istWindow(0);
  } else if (effectiveFollowup === "tomorrow") {
    where.followupDate = istWindow(1);
  } else if (effectiveFollowup === "overdue") {
    where.followupDate = { lt: new Date(), not: null };
  } else if (effectiveFollowup === "week") {
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
  } else if (effectiveFollowup === "month") {
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
  }

  // Smart filter presets
  const smartAnd: Prisma.LeadWhereInput[] = [];
  if (sp.smart === "hot_today") {
    smartAnd.push({ aiScore: AIScore.HOT });
    smartAnd.push({ createdAt: { gte: istWindow(0).gte } });
  } else if (sp.smart === "ghosting") {
    smartAnd.push({ lastTouchedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
    smartAnd.push({ status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } });
  } else if (sp.smart === "visit_potential") {
    smartAnd.push({ status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT] } });
  } else if (sp.smart === "high_budget") {
    smartAnd.push({
      OR: [
        { budgetCurrency: "AED", budgetMin: { gte: 5_000_000 } },
        { budgetCurrency: "INR", budgetMin: { gte: 30_000_000 } },
      ],
    });
  }
  if (smartAnd.length > 0) {
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), ...smartAnd]
      : smartAnd;
  }

  if (sp.tag) {
    const tagFilter: Prisma.LeadWhereInput = { tags: { contains: sp.tag } };
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), tagFilter]
      : [tagFilter];
  }

  // ── Fetch up to 5000 leads ───────────────────────────────────────────────
  const leads = await prisma.lead.findMany({
    where,
    take: 5000,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      potential: true,
      fundReadiness: true,
      budgetMin: true,
      budgetMax: true,
      budgetCurrency: true,
      followupDate: true,
      lastTouchedAt: true,
      createdAt: true,
      forwardedTeam: true,
      originalSheetStatus: true,
      source: true,
      owner: { select: { name: true } },
    },
  });

  // ── Build CSV manually ───────────────────────────────────────────────────
  const HEADER = "ID,Name,Phone,Email,Status,Potential,Fund Readiness,Budget,Team,Source,Follow-up Date,Last Touched,Created,Assigned To,Original Sheet Status";

  const rows = leads.map((l) => {
    const budget =
      l.budgetMin != null
        ? `${l.budgetCurrency} ${l.budgetMin}${l.budgetMax != null ? `-${l.budgetMax}` : ""}`
        : "";
    return [
      l.id,
      l.name,
      l.phone ?? "",
      l.email ?? "",
      l.status,
      l.potential ?? "",
      l.fundReadiness ?? "",
      budget,
      l.forwardedTeam ?? "",
      l.source,
      toDate(l.followupDate),
      toDate(l.lastTouchedAt),
      toDate(l.createdAt),
      l.owner?.name ?? "",
      l.originalSheetStatus ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  const csvString = [HEADER, ...rows].join("\r\n");

  return new Response(csvString, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="leads.csv"',
    },
  });
}

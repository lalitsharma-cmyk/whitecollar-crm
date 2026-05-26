import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, AIScore, Prisma } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { fmtMoney } from "@/lib/money";
import { requireUser } from "@/lib/auth";
import LeadFilters from "@/components/LeadFilters";
import SavedFiltersBar from "@/components/SavedFiltersBar";
import LeadsListClient from "@/components/LeadsListClient";
import { runReconciler } from "@/lib/reconciler";
import { leadScopeWhere } from "@/lib/leadScope";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const srcChip: Record<LeadSource, string> = {
  WEBSITE: "src-web", WHATSAPP: "src-wa", CSV_IMPORT: "src-csv", EVENT: "src-event",
  REFERRAL: "src", INBOUND_CALL: "src-call", FACEBOOK_ADS: "src-web", GOOGLE_ADS: "src-csv",
  PORTAL_99ACRES: "src", PORTAL_MAGICBRICKS: "src", PORTAL_HOUSING: "src", OTHER: "src",
};
const srcLabel: Record<LeadSource, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook",
  GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing", OTHER: "Other",
};
const statusChip: Record<LeadStatus, string> = {
  NEW: "chip-new", CONTACTED: "chip-warm", QUALIFIED: "chip-warm", SITE_VISIT: "chip-warm",
  NEGOTIATION: "chip-warm", BOOKING_DONE: "chip-won", WON: "chip-won", LOST: "chip-lost",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  runReconciler().catch(() => {});
  const sp = await searchParams;

  // Build where clause from filters
  // 1. Agents only see leads they own — leadScopeWhere applies the ownerId filter.
  // 2. By default, hide cold-call leads (they live in /cold-calls). User can opt-in
  //    by adding ?showCold=1 to the URL.
  const scope = await leadScopeWhere(me);
  const where: Prisma.LeadWhereInput = sp.showCold === "1"
    ? { ...scope }
    : { ...scope, isColdCall: false };
  if (sp.q) {
    where.OR = [
      { name: { contains: sp.q, mode: "insensitive" } },
      { phone: { contains: sp.q } },
      { email: { contains: sp.q, mode: "insensitive" } },
      { company: { contains: sp.q, mode: "insensitive" } },
    ];
  }
  // Agents never see source — they can't filter by it either, even by hand-crafting
  // the ?source= URL. Without this guard an agent could probe the source distribution
  // by setting the param and watching the result count, defeating the privacy policy.
  if (sp.source && me.role !== "AGENT") where.source = sp.source as LeadSource;
  if (sp.status) where.status = sp.status as LeadStatus;
  if (sp.ai) where.aiScore = sp.ai as AIScore;
  if (sp.team) where.forwardedTeam = sp.team;
  if (sp.owner === "unassigned") where.ownerId = null;
  else if (sp.owner) where.ownerId = sp.owner;
  if (sp.when === "24h") where.createdAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };
  else if (sp.when === "7d") where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
  else if (sp.when === "30d") where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
  else if (sp.when === "overdue") where.lastTouchedAt = { lt: new Date(Date.now() - 5 * 24 * 3600 * 1000) };

  // Quick filter: ?followup=today  → leads whose followupDate falls within today IST.
  // Lalit asked: "Agent is unable to track what are today's follow up... make it
  // filter in leads for agent today's followups."
  if (sp.followup === "today") {
    // Today in IST as a UTC window: 00:00 IST = 18:30 UTC the previous day.
    const istOffsetMs = 330 * 60 * 1000;
    const nowIST = new Date(Date.now() + istOffsetMs);
    const startIST = new Date(nowIST); startIST.setUTCHours(0, 0, 0, 0);
    const endIST = new Date(startIST); endIST.setUTCDate(endIST.getUTCDate() + 1);
    where.followupDate = {
      gte: new Date(startIST.getTime() - istOffsetMs),
      lt: new Date(endIST.getTime() - istOffsetMs),
    };
  } else if (sp.followup === "overdue") {
    // Past-due followups (older than now) — agent missed them
    where.followupDate = { lt: new Date(), not: null };
  } else if (sp.followup === "week") {
    // Next 7 days
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
  }

  // Sort
  let orderBy: Prisma.LeadOrderByWithRelationInput = { createdAt: "desc" };
  if (sp.sort === "created_asc") orderBy = { createdAt: "asc" };
  else if (sp.sort === "score_desc") orderBy = { aiScoreValue: "desc" };
  else if (sp.sort === "touched_asc") orderBy = { lastTouchedAt: "asc" };
  else if (sp.sort === "touched_desc") orderBy = { lastTouchedAt: "desc" };
  else if (sp.sort === "name_asc") orderBy = { name: "asc" };

  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Today-IST window for the followup quick chip counts (scoped to the visible
  // leads — agents see counts for their own pipeline, admin sees the whole org)
  const istOffsetMs = 330 * 60 * 1000;
  const nowIST = new Date(Date.now() + istOffsetMs);
  const startToday = new Date(nowIST); startToday.setUTCHours(0, 0, 0, 0);
  const endToday = new Date(startToday); endToday.setUTCDate(endToday.getUTCDate() + 1);
  const todayWindow = {
    gte: new Date(startToday.getTime() - istOffsetMs),
    lt: new Date(endToday.getTime() - istOffsetMs),
  };

  const [leads, total, hot, newToday, totalAll, agents, followupToday, followupOverdue] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy, skip, take: PAGE_SIZE,
      include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...scope, aiScore: AIScore.HOT } }),
    prisma.lead.count({ where: { ...scope, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.lead.count({ where: scope }),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
    // Today's followups in the agent's pipeline (or all for admin)
    prisma.lead.count({ where: { ...scope, followupDate: todayWindow, status: { notIn: ["WON", "LOST"] } } }),
    // Overdue followups (set in the past)
    prisma.lead.count({ where: { ...scope, followupDate: { lt: new Date(), not: null }, status: { notIn: ["WON", "LOST"] } } }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canBulk = me.role === "ADMIN" || me.role === "MANAGER";

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Leads</h1>
          <p className="text-xs sm:text-sm text-gray-500">{totalAll} total · {newToday} new in last 24h · {hot} hot · showing {total} matching</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/intake" className="btn btn-ghost flex-1 sm:flex-none justify-center">Import</Link>
          {me.role === "ADMIN" && (
            <a href="/api/reports/export?type=leads" className="btn btn-ghost flex-1 sm:flex-none justify-center">Export</a>
          )}
          <Link href="/leads/new" className="btn btn-primary flex-1 sm:flex-none justify-center">+ New Lead</Link>
        </div>
      </div>

      {/* Quick filter chips — Lalit asked for prominent today's-followups visibility.
          Counts are scoped to the user's pipeline (agent sees their own; admin sees all). */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/leads"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center gap-1 ${!sp.followup ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "bg-white border-[#e5e7eb] text-gray-700"}`}
        >
          All leads
        </Link>
        <Link
          href="/leads?followup=today"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center gap-1 ${sp.followup === "today" ? "bg-emerald-600 text-white border-emerald-600" : "bg-emerald-50 border-emerald-300 text-emerald-800"}`}
        >
          📅 Today&apos;s follow-ups {followupToday > 0 && <span className="bg-white/20 px-1.5 rounded">{followupToday}</span>}
        </Link>
        <Link
          href="/leads?followup=overdue"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center gap-1 ${sp.followup === "overdue" ? "bg-red-600 text-white border-red-600" : "bg-red-50 border-red-300 text-red-800"}`}
        >
          ⏰ Overdue {followupOverdue > 0 && <span className="bg-white/20 px-1.5 rounded">{followupOverdue}</span>}
        </Link>
        <Link
          href="/leads?followup=week"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center gap-1 ${sp.followup === "week" ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50 border-blue-300 text-blue-800"}`}
        >
          📆 Next 7 days
        </Link>
      </div>

      <SavedFiltersBar />

      <LeadFilters
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        sources={Object.values(LeadSource)}
        statuses={Object.values(LeadStatus)}
        showSource={me.role !== "AGENT"}
      />

      <LeadsListClient
        canBulk={canBulk}
        showSource={me.role !== "AGENT"}
        agents={agents.map((a) => ({ id: a.id, name: a.name, team: a.team }))}
        leads={leads.map((l) => ({
          id: l.id, name: l.name, phone: l.phone, email: l.email,
          source: l.source, statusName: l.status,
          srcChip: srcChip[l.source], srcLabel: srcLabel[l.source],
          statusChip: statusChip[l.status],
          aiScore: l.aiScore, aiScoreValue: l.aiScoreValue,
          team: l.forwardedTeam,
          owner: l.owner ? { name: l.owner.name, avatarColor: l.owner.avatarColor ?? "bg-slate-500" } : null,
          budget: l.budgetMin ? fmtMoney(l.budgetMin, l.budgetCurrency) : null,
          interest: l.interestedUnits[0] ? `${l.interestedUnits[0].unit.project.name} ${l.interestedUnits[0].unit.configuration}` : null,
          lastTouched: l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: true }) : "—",
        }))}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500">Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}</div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={`?${new URLSearchParams({ ...sp as Record<string,string>, page: String(page - 1) }).toString()}`} className="btn btn-ghost">‹ Prev</Link>
          )}
          <span className="px-3 py-2 text-xs text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`?${new URLSearchParams({ ...sp as Record<string,string>, page: String(page + 1) }).toString()}`} className="btn btn-ghost">Next ›</Link>
          )}
        </div>
      </div>
    </>
  );
}

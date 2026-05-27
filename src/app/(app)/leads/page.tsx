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

  // EOI / booking-funnel filters — driven by the dashboard's EOI Pipeline tiles
  // (admin/manager view). Surfaces leads at specific points in the booking funnel:
  //   active           → anyone with eoiStage set (mid-funnel)
  //   kyc_pending      → KYC docs still outstanding
  //   approval_needed  → eoiApprovalRequired === true (manager sign-off)
  //   stuck            → EOI collected > 7 days ago but booking not yet done
  if (sp.eoi === "active") where.eoiStage = { not: null };
  else if (sp.eoi === "kyc_pending") where.kycStatus = "PENDING";
  else if (sp.eoi === "approval_needed") where.eoiApprovalRequired = true;
  else if (sp.eoi === "stuck") {
    where.bookingDoneAt = null;
    where.eoiCollectedAt = { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000), not: null };
  }

  // Quick filter: ?notPicked=N  → leads where (a) at least one no-answer call
  // has happened in the last N days AND (b) no CONNECTED / INTERESTED call has
  // happened in that window. Lalit asked: "If client is not picking calls from
  // 3 Days, there should be a tag added so filtration can be easy."
  // Allowed values: 2, 3, 5, 7, 14. Anything else → ignored.
  const notPickedDays = sp.notPicked ? parseInt(sp.notPicked) : null;
  if (notPickedDays && [2, 3, 5, 7, 14].includes(notPickedDays)) {
    const sinceMs = Date.now() - notPickedDays * 24 * 3600 * 1000;
    const since = new Date(sinceMs);
    // Subquery via Prisma's some/none filters on the callLogs relation.
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

  // Quick filter: ?followup=today  → leads whose followupDate falls within today IST.
  // Lalit asked: "Agent is unable to track what are today's follow up... make it
  // filter in leads for agent today's followups."
  // Compute today's IST midnight bounds once — re-used by today/tomorrow chips.
  const istOffsetMs = 330 * 60 * 1000;
  const nowISTBoundary = new Date(Date.now() + istOffsetMs);
  const istMidnight = new Date(nowISTBoundary); istMidnight.setUTCHours(0, 0, 0, 0);
  const istWindow = (offsetDays: number) => {
    const start = new Date(istMidnight); start.setUTCDate(start.getUTCDate() + offsetDays);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
    return {
      gte: new Date(start.getTime() - istOffsetMs),
      lt:  new Date(end.getTime()   - istOffsetMs),
    };
  };

  // DEFAULT view = "Today's follow-ups" (Lalit's ask: "By default on leads
  // page Today's follow ups should show"). The agent opens /leads and lands
  // on their priority list for the day. Explicit "show everything" via
  // ?followup=all. Other filters (search, source, owner, etc.) bypass this
  // default — if any non-followup filter is in the URL, treat as a targeted
  // search and show all matching, not just today's.
  const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.owner || sp.team || sp.score || sp.notPicked || sp.eoi);
  const effectiveFollowup = sp.followup ?? (hasOtherFilter ? "all" : "today");

  if (effectiveFollowup === "today") {
    // Today in IST as a UTC window: 00:00 IST = 18:30 UTC the previous day.
    where.followupDate = istWindow(0);
  } else if (effectiveFollowup === "tomorrow") {
    // Tomorrow in IST — same window logic, shifted +1 day.
    where.followupDate = istWindow(1);
  } else if (effectiveFollowup === "overdue") {
    // Past-due followups (older than now) — agent missed them.
    where.followupDate = { lt: new Date(), not: null };
  } else if (effectiveFollowup === "week") {
    // Next 7 days from now (inclusive of today).
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
  } else if (effectiveFollowup === "month") {
    // Next 30 days from now (inclusive of today).
    where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
  }
  // effectiveFollowup === "all" → no followupDate filter applied.

  // Smart-filter preset chips — spec §9.3. Composes via AND so it does not
  // replace existing followup / status / source filters. Each preset is a
  // named, opinionated combination of conditions surfaced as a top-row chip.
  const smartAnd: Prisma.LeadWhereInput[] = [];
  if (sp.smart === "hot_today") {
    // 🔥 Hot today — AI flagged HOT and created since midnight IST today.
    smartAnd.push({ aiScore: AIScore.HOT });
    smartAnd.push({ createdAt: { gte: istWindow(0).gte } });
  } else if (sp.smart === "ghosting") {
    // 👻 Ghosting — no touch in 7+ days and still in-pipeline.
    smartAnd.push({ lastTouchedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
    smartAnd.push({ status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } });
  } else if (sp.smart === "visit_potential") {
    // 🏢 Site-visit potential — qualified or already scheduled for a visit.
    smartAnd.push({ status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT] } });
  } else if (sp.smart === "high_budget") {
    // 💎 High budget — ≥ 5M AED or ≥ 3 Cr INR. Currency-aware OR.
    smartAnd.push({
      OR: [
        { budgetCurrency: "AED", budgetMin: { gte: 5_000_000 } },
        { budgetCurrency: "INR", budgetMin: { gte: 30_000_000 } },
      ],
    });
  }
  if (smartAnd.length > 0) {
    where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), ...smartAnd] : smartAnd;
  }

  // Tag filter — composes with the existing AND chain via `contains`. Tags is
  // a comma-separated string column ("NRI,Investor,HNI"), so substring match
  // is good enough; the dropdown options come from a DISTINCT query over the
  // actual data so we never offer a tag nobody has.
  if (sp.tag) {
    const tagFilter: Prisma.LeadWhereInput = { tags: { contains: sp.tag } };
    where.AND = where.AND
      ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), tagFilter]
      : [tagFilter];
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

  // Followup windows for chip counts (scoped to visible leads — agents see
  // their own pipeline, admin sees all). Re-use istWindow() defined above.
  const todayWindow    = istWindow(0);
  const tomorrowWindow = istWindow(1);
  const weekWindow     = { gte: new Date(), lte: new Date(Date.now() + 7  * 24 * 3600 * 1000) };
  const monthWindow    = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
  const activeScope    = { ...scope, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } };

  const [leads, total, hot, newToday, totalAll, agents, followupToday, followupTomorrow, followupWeek, followupMonth, followupOverdue, allTagRows] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy, skip, take: PAGE_SIZE,
      include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...scope, aiScore: AIScore.HOT } }),
    prisma.lead.count({ where: { ...scope, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.lead.count({ where: scope }),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: todayWindow } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: tomorrowWindow } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: weekWindow } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: monthWindow } }),
    prisma.lead.count({ where: { ...activeScope, followupDate: { lt: new Date(), not: null } } }),
    // DISTINCT tag list — Lead.tags is a comma-separated string, so split it
    // server-side (Postgres) with string_to_array + unnest, trim each tag,
    // drop empties, and dedupe. Drives the tag-filter <select> below so we
    // only ever offer tags that actually exist in the dataset.
    prisma.$queryRaw<Array<{ tag: string }>>`
      SELECT DISTINCT TRIM(t) AS tag
      FROM (
        SELECT UNNEST(string_to_array(tags, ',')) AS t
        FROM "Lead"
        WHERE tags IS NOT NULL AND tags <> ''
      ) AS s
      WHERE TRIM(t) <> ''
      ORDER BY tag ASC
    `,
  ]);

  const distinctTags: string[] = allTagRows
    .map((r) => r.tag)
    .filter((t): t is string => typeof t === "string" && t.length > 0);

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

      {/* ─── SMART FILTER PRESETS (spec §9.3) ───────────────────────────
          Named one-tap presets that compose with the existing followup /
          status / source filters via AND. Sits above the follow-up row so
          the agent's eye lands on these high-signal slices first. */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
          ⚡ Smart filters
        </div>
        <div className="flex gap-2 overflow-x-auto lg:flex-wrap pb-1 -mx-3 px-3 lg:mx-0 lg:px-0 scrollbar-thin">
          <Link
            href="/leads?smart=hot_today"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.smart === "hot_today" ? "bg-orange-600 text-white border-orange-600" : "bg-orange-50 border-orange-300 text-orange-800"}`}
          >
            🔥 Hot today
          </Link>
          <Link
            href="/leads?smart=ghosting"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.smart === "ghosting" ? "bg-purple-600 text-white border-purple-600" : "bg-purple-50 border-purple-300 text-purple-800"}`}
          >
            👻 Ghosting
          </Link>
          <Link
            href="/leads?smart=visit_potential"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.smart === "visit_potential" ? "bg-teal-600 text-white border-teal-600" : "bg-teal-50 border-teal-300 text-teal-800"}`}
          >
            🏢 Site visit potential
          </Link>
          <Link
            href="/leads?smart=high_budget"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.smart === "high_budget" ? "bg-amber-600 text-white border-amber-600" : "bg-amber-50 border-amber-300 text-amber-800"}`}
          >
            💎 High budget
          </Link>
          {/* Tag-filter dropdown — populated from DISTINCT tags actually in
              the dataset (server-side via $queryRaw above). Sits inline with
              the smart-filter chips so agents can slice by NRI/Investor/HNI
              without leaving the keyboard-flow of the chip row. Submits a
              plain GET form so it composes with whatever other filters are in
              the URL — picking a tag does NOT clear ?followup, ?status, etc. */}
          {distinctTags.length > 0 && (
            <form method="GET" action="/leads" className="inline-flex items-center gap-1">
              <label htmlFor="tag-filter" className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold pl-1">
                🏷 Tag
              </label>
              {/* Server-rendered <select> — no onChange (would force the whole
                  page to be a client component). Agent picks a tag then taps
                  Apply; the form GETs /leads?tag=X and the server re-renders. */}
              <select
                id="tag-filter"
                name="tag"
                defaultValue={sp.tag ?? ""}
                className={`px-2 py-2 rounded-full text-xs font-semibold border min-h-11 ${sp.tag ? "bg-fuchsia-600 text-white border-fuchsia-600" : "bg-white border-[#e5e7eb] text-gray-700"}`}
              >
                <option value="">All tags</option>
                {distinctTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="submit"
                className="px-3 py-2 rounded-full text-xs font-semibold border min-h-11 bg-white border-[#e5e7eb] text-gray-700 hover:bg-gray-50"
              >
                Apply
              </button>
              {sp.tag && (
                <Link
                  href="/leads"
                  className="px-2 py-2 text-[11px] text-gray-500 hover:text-gray-800"
                  title="Clear tag filter"
                >
                  ✕
                </Link>
              )}
            </form>
          )}
        </div>
      </div>

      {/* ─── FOLLOW-UPS section ─────────────────────────────────────────
          Lalit's ask: "Make section, filter for Followup — today, tomorrow,
          week, month". Grouped under a labelled header so agents see the
          full timeline of upcoming follow-ups at a glance.
          Counts are scoped to the agent's own pipeline (admin sees all). */}
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-2">
          <span>📅 Follow-ups</span>
          <span className="text-[9px] font-normal text-gray-400 normal-case tracking-normal hidden sm:inline">
            (default view shows today's — tap All to see everything)
          </span>
        </div>
        {/* Mobile: chips scroll horizontally so they stay on ONE line, not
            3 wrapping lines. Lalit: "Filters on Lead page takes so much space
            that user has to scroll down to see the lead in mobile." Desktop
            keeps flex-wrap so they all show at once.
            -mx-3 + px-3 lets the scroll extend edge-to-edge inside p-3 page padding. */}
        <div className="flex gap-2 overflow-x-auto lg:flex-wrap pb-1 -mx-3 px-3 lg:mx-0 lg:px-0 scrollbar-thin">
          <style>{`
            .scrollbar-thin::-webkit-scrollbar { height: 4px; }
            .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 2px; }
          `}</style>
          <Link
            href="/leads?followup=all"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "all" ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "bg-white border-[#e5e7eb] text-gray-700"}`}
          >
            All leads
          </Link>
          <Link
            href="/leads?followup=overdue"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "overdue" ? "bg-red-600 text-white border-red-600" : "bg-red-50 border-red-300 text-red-800"}`}
          >
            ⏰ Overdue {followupOverdue > 0 && <span className={`px-1.5 rounded ${effectiveFollowup === "overdue" ? "bg-white/20" : "bg-red-200/60"}`}>{followupOverdue}</span>}
          </Link>
          <Link
            href="/leads?followup=today"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "today" ? "bg-emerald-600 text-white border-emerald-600" : "bg-emerald-50 border-emerald-300 text-emerald-800"}`}
          >
            Today {followupToday > 0 && <span className={`px-1.5 rounded ${effectiveFollowup === "today" ? "bg-white/20" : "bg-emerald-200/60"}`}>{followupToday}</span>}
          </Link>
          <Link
            href="/leads?followup=tomorrow"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "tomorrow" ? "bg-teal-600 text-white border-teal-600" : "bg-teal-50 border-teal-300 text-teal-800"}`}
          >
            Tomorrow {followupTomorrow > 0 && <span className={`px-1.5 rounded ${effectiveFollowup === "tomorrow" ? "bg-white/20" : "bg-teal-200/60"}`}>{followupTomorrow}</span>}
          </Link>
          <Link
            href="/leads?followup=week"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "week" ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50 border-blue-300 text-blue-800"}`}
          >
            This week {followupWeek > 0 && <span className={`px-1.5 rounded ${effectiveFollowup === "week" ? "bg-white/20" : "bg-blue-200/60"}`}>{followupWeek}</span>}
          </Link>
          <Link
            href="/leads?followup=month"
            className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${effectiveFollowup === "month" ? "bg-indigo-600 text-white border-indigo-600" : "bg-indigo-50 border-indigo-300 text-indigo-800"}`}
          >
            This month {followupMonth > 0 && <span className={`px-1.5 rounded ${effectiveFollowup === "month" ? "bg-white/20" : "bg-indigo-200/60"}`}>{followupMonth}</span>}
          </Link>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto lg:flex-wrap pb-1 -mx-3 px-3 lg:mx-0 lg:px-0 scrollbar-thin">
        {/* Not-picked filter chips — Lalit's ask: "If client is not picking
            calls from 3 Days, there should be a tag added so filtration can be
            easy. Call not pick form 2, 3, 4, 5,6 7, days type of tag." */}
        <Link
          href="/leads?notPicked=3"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.notPicked === "3" ? "bg-amber-600 text-white border-amber-600" : "bg-amber-50 border-amber-300 text-amber-800"}`}
        >
          📵 Not picked 3+ days
        </Link>
        <Link
          href="/leads?notPicked=7"
          className={`px-3 py-2 rounded-full text-xs font-semibold border min-h-11 inline-flex items-center gap-1 ${sp.notPicked === "7" ? "bg-red-600 text-white border-red-600" : "bg-red-50 border-red-300 text-red-800"}`}
        >
          📵 Not picked 7+ days
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
        canReassign={canBulk}
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

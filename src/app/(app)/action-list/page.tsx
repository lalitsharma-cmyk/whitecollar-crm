import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SUPPRESSED_STATUSES, CLOSING_STATUSES, statusesForTeam } from "@/lib/lead-statuses";
import { formatBudget } from "@/lib/budgetParse";
import { formatDistanceToNow } from "date-fns";
import { runReconciler } from "@/lib/reconciler";
import { leadScopeWhere, ACTIVE_ORIGIN_WHERE, activeBoardWhere } from "@/lib/leadScope";
import { freshUntouchedWhere } from "@/lib/freshLeads";
import { istDayRange, istDateKey, isValidDateKey } from "@/lib/datetime";
import { contactActivityByLeadToday } from "@/lib/followupGate";
import { waDraftLink } from "@/lib/wa";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import ActionCardClient from "@/components/ActionCardClient";
import { lastMeaningfulRemark } from "@/lib/needSnapshot";
import { formatLeadName } from "@/lib/leadName";
import { normalizeTeam, TEAMS } from "@/lib/teamRouting";

export const dynamic = "force-dynamic";

// ── Per-card shape ────────────────────────────────────────────────────
// Decoupled from the raw Lead row so the JSX stays readable. The flagKind
// drives the section color, urgent-glow rules, and the default Snooze/
// Escalate values inside ActionCardClient.
interface CardData {
  id: string; name: string; phone: string | null;
  team: string | null; ownerName: string | null;
  lastTouchedAt: Date | null;
  followupDate: Date | null;
  status: string; currentStatus: string | null;
  todoNext: string | null; aiNextAction: string | null;
  remarks: string | null; whoIsClient: string | null;
  budget: { min: number | null; max: number | null; currency: string };
  needsManagerReason?: string | null;
  flagKind: "ready_close" | "overdue" | "needs_you" | "followup" | "fresh";
  needSummary: string | null;
  configuration: string | null;
  whenCanInvest: string | null;
  potential: string | null;
}

// Canonical house format (Dubai "2M AED" / India "21 Cr") — single source of truth.
function fmtAEDInr(min: number | null, currency: string) {
  if (!min) return "—";
  return formatBudget(min, currency);
}

// AI reason text per stage (the master spec § 9.2 calls for "AI reason text"
// on each card so the agent understands at a glance why this card is on top).
function aiNextStep(card: CardData): { step: string; why: string } {
  const { status, todoNext, aiNextAction, budget, needSummary, configuration, whenCanInvest, potential, team: forwardedTeam, remarks } = card;
  const team = forwardedTeam ?? "Dubai";

  // Build context snippets for the step text
  const budgetStr = budget.min ? formatBudget(budget.min, budget.currency) : null;
  const configStr = configuration ?? null;
  const needStr = needSummary ?? null;
  const timeline = whenCanInvest ? whenCanInvest.replace("_", " ").toLowerCase() : null;

  // Build a concise context suffix
  const contextParts: string[] = [];
  if (budgetStr) contextParts.push(`budget ${budgetStr}`);
  if (configStr) contextParts.push(configStr);
  if (needStr && needStr.length < 60) contextParts.push(needStr);
  if (timeline && timeline !== "unknown") contextParts.push(`timeline: ${timeline}`);
  const ctx = contextParts.length > 0 ? ` (${contextParts.join(", ")})` : "";

  // Step and why based on stage + context
  if (status === "NEGOTIATION") return {
    step: `Close NOW — push for token/booking and confirm payment plan${ctx}.`,
    why: "Closing stage — momentum is critical. A direct manager push can seal the deal.",
  };
  if (status === "SITE_VISIT") return {
    step: aiNextAction ?? `Confirm the site visit slot and share brochure/payment plan for ${team}${ctx}.`,
    why: "Site visit booked — keep momentum. Confirm timing and address any objections now.",
  };
  if (status === "QUALIFIED") return {
    step: todoNext ?? `Schedule a ${team === "India" ? "virtual or office" : "Dubai site"} visit${ctx}.`,
    why: `Qualified lead${potential === "HIGH" ? " (HIGH potential)" : ""} — next step is to lock a visit.`,
  };
  if (status === "CONTACTED") {
    // Use last remark for context if available
    // Clean, substantive last line — not a raw slice of the conversation blob.
    const remarkHint = lastMeaningfulRemark(remarks);
    return {
      step: todoNext ?? (remarkHint
        ? `Re-engage based on last conversation: "${remarkHint}"${ctx}`
        : `Call and re-engage with project-specific info${ctx}.`),
      why: "Contacted but no progress — a personal follow-up helps break the silence.",
    };
  }
  return {
    step: todoNext ?? aiNextAction ?? `First call within the hour — introduce ${team} investment opportunity${ctx}.`,
    why: "New or idle lead — early contact dramatically improves conversion.",
  };
}

function makeCard(l: any, flagKind: CardData["flagKind"]): CardData {
  return {
    id: l.id, name: formatLeadName(l.name), phone: l.phone,
    team: l.forwardedTeam, ownerName: l.owner?.name ?? null,
    lastTouchedAt: l.lastTouchedAt,
    followupDate: l.followupDate,
    status: l.status, currentStatus: l.currentStatus,
    todoNext: l.todoNext, aiNextAction: l.aiNextAction,
    remarks: l.remarks, whoIsClient: l.whoIsClient,
    budget: { min: l.budgetMin, max: l.budgetMax, currency: l.budgetCurrency ?? "AED" },
    needsManagerReason: l.managerReviewReason,
    flagKind,
    needSummary: l.needSummary ?? null,
    configuration: l.configuration ?? null,
    whenCanInvest: l.whenCanInvest ?? null,
    potential: l.potential ?? null,
  };
}

/** How many hours overdue this follow-up is. Negative = future. */
function hoursOverdue(followupDate: Date | null): number {
  if (!followupDate) return 0;
  return Math.round((Date.now() - followupDate.getTime()) / 3600_000);
}

// ── Date-window resolution ──────────────────────────────────────────────
// The Action List is a FOLLOW-UP board. Its source of truth is Lead.followupDate.
// `when` selects which slice of the calendar we show:
//   today    → every follow-up whose date lands on the IST day "today"
//   tomorrow → the next IST day
//   overdue  → followupDate strictly before the start of today (IST) — still actionable
//   date     → an explicit ?date=YYYY-MM-DD (IST day)
// IMPORTANT: a follow-up scheduled for 6pm today is NOT overdue — "Today" must
// show it. The old page had no Today bucket at all, so afternoon/evening
// follow-ups were invisible until they slipped past midnight into Overdue.
type WhenKey = "today" | "tomorrow" | "overdue" | "date";

function resolveWindow(when: WhenKey, dateKey: string): { followup: Prisma.DateTimeFilter<"Lead">; label: string } {
  if (when === "overdue") {
    const { start } = istDayRange(); // start of today (IST)
    // `lt` already excludes NULL followupDate rows (NULL never satisfies a
    // comparison), so this is exactly "has a follow-up, and it's before today".
    return { followup: { lt: start }, label: "Overdue follow-ups" };
  }
  if (when === "tomorrow") {
    const t = istDayRange(new Date(Date.now() + 24 * 3600 * 1000));
    return { followup: { gte: t.start, lt: t.end }, label: "Tomorrow's follow-ups" };
  }
  if (when === "date") {
    const d = istDayRange(dateKey);
    return { followup: { gte: d.start, lt: d.end }, label: `Follow-ups on ${dateKey}` };
  }
  // today (default)
  const d = istDayRange();
  return { followup: { gte: d.start, lt: d.end }, label: "Today's follow-ups" };
}

export default async function ActionListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  runReconciler().catch(() => {});

  const sp = await searchParams;

  // ── Filter inputs ──────────────────────────────────────────────────────
  const rawWhen = (sp.when ?? "today").toLowerCase();
  const when: WhenKey = (["today", "tomorrow", "overdue", "date"] as const).includes(rawWhen as WhenKey)
    ? (rawWhen as WhenKey)
    : "today";
  // If a ?date= is supplied we honour it; default the custom field to today.
  const dateKey = isValidDateKey(sp.date) ? sp.date : istDateKey();
  const effectiveWhen: WhenKey = sp.date && isValidDateKey(sp.date) ? "date" : when;

  const agentFilter = sp.agent && sp.agent !== "" ? sp.agent : null;
  const teamFilter = sp.team && normalizeTeam(sp.team) ? normalizeTeam(sp.team) : null;
  const statusFilter = sp.status && sp.status !== "" ? sp.status : null;

  // ── Permission scope — THE legitimate filter (never hides by status) ────
  // leadScopeWhere encodes: ADMIN → all; MANAGER → own team; AGENT → own leads.
  // It always applies deletedAt:null too, so deleted leads never appear.
  const scopeWhere = await leadScopeWhere(me);

  const { followup, label: windowLabel } = resolveWindow(effectiveWhen, dateKey);

  // Compose the follow-up WHERE through the canonical Active-Board envelope
  // (activeBoardWhere): permission scope + the Jun26 board exclusions —
  //   • terminal/rejected leads NEVER appear (a rejected lead that still carries a
  //     follow-up is a Revisit, surfaced on /revisit-queue, not here),
  //   • MASTER_DATA-origin leads appear ONLY when assigned (ownerId) AND scheduled
  //     (followupDate) — untriaged Master-Data imports stay off the board.
  // We still DO NOT narrow by status here (the whole follow-up board shows for the
  // date); the explicit Status filter below is the only status narrowing. The
  // SAME activeBoardWhere drives the Leads follow-up chips + Dashboard follow-up
  // widgets, so the Action-List ⇄ Leads reconciliation holds.
  const followupWhere: Prisma.LeadWhereInput = {
    ...activeBoardWhere(scopeWhere),
    followupDate: followup,
  };
  if (agentFilter) followupWhere.ownerId = agentFilter;
  if (teamFilter) followupWhere.forwardedTeam = teamFilter;
  if (statusFilter) followupWhere.currentStatus = statusFilter;

  const leadSelect = {
    id: true, name: true, phone: true, status: true,
    forwardedTeam: true, lastTouchedAt: true, followupDate: true,
    currentStatus: true, todoNext: true, aiNextAction: true,
    remarks: true, whoIsClient: true,
    budgetMin: true, budgetMax: true, budgetCurrency: true,
    needSummary: true, configuration: true, whenCanInvest: true,
    potential: true, managerReviewReason: true,
    owner: { select: { name: true } },
  } as const;

  // For Overdue we list soonest-overdue first (closest to today). For dated
  // views we order by the time-of-day of the follow-up so the agent's day is
  // sequenced. Count and list use the SAME where → count == records, always.
  // Fresh-untouched-today section (Lalit, 2026-07-01) — assigned today, no first
  // contact yet. Independent of followupDate (they often have none), so they get
  // their own top section rather than living on the follow-up board. Respects the
  // agent/team filters. Single source of truth: freshLeads.freshUntouchedWhere.
  const freshWhere: Prisma.LeadWhereInput = { ...freshUntouchedWhere(scopeWhere) };
  if (agentFilter) freshWhere.ownerId = agentFilter;
  if (teamFilter) freshWhere.forwardedTeam = teamFilter;

  const [followups, followupCount, readyToClose, needsYou, freshUntouched, agents] = await Promise.all([
    prisma.lead.findMany({
      where: followupWhere,
      orderBy: { followupDate: effectiveWhen === "overdue" ? "desc" : "asc" },
      take: 300,
      select: leadSelect,
    }),
    prisma.lead.count({ where: followupWhere }),
    // Secondary context sections (unchanged scope: active pipeline only — cold/
    // revival/master-data leads never surface here, matching the prior page).
    prisma.lead.findMany({
      where: { ...scopeWhere, ...ACTIVE_ORIGIN_WHERE, currentStatus: { in: CLOSING_STATUSES } },
      orderBy: { lastTouchedAt: "desc" },
      take: 10,
      select: leadSelect,
    }),
    prisma.lead.findMany({
      where: { ...scopeWhere, ...ACTIVE_ORIGIN_WHERE, needsManagerReview: true, currentStatus: { notIn: SUPPRESSED_STATUSES } },
      orderBy: { flaggedAt: "desc" },
      take: 15,
      select: leadSelect,
    }),
    prisma.lead.findMany({
      where: freshWhere,
      orderBy: { assignedAt: "desc" }, // newest assignment first
      take: 50,
      select: leadSelect,
    }),
    // Agent dropdown — scoped to who the viewer can see. AGENT gets no list
    // (they only see their own leads anyway, so the filter is hidden for them).
    me.role === "AGENT"
      ? Promise.resolve([] as { id: string; name: string; team: string | null }[])
      : prisma.user.findMany({
          where: {
            active: true, hrOnly: false,
            role: { in: ["AGENT", "MANAGER"] },
            ...(me.role === "MANAGER" && normalizeTeam(me.team ?? undefined)
              ? { team: normalizeTeam(me.team ?? undefined)! }
              : {}),
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, team: true },
        }),
  ]);

  // Contact-today flags for the Complete-button gate. One batch query over every
  // lead that will render on this page (follow-ups + the two context sections).
  // hasContactToday(leadId) → enables Complete; otherwise it's disabled w/ tooltip.
  const allCardLeadIds = Array.from(new Set([
    ...followups.map((l) => l.id),
    ...readyToClose.map((l) => l.id),
    ...needsYou.map((l) => l.id),
    ...freshUntouched.map((l) => l.id),
  ]));
  const contactByLead = await contactActivityByLeadToday(allCardLeadIds);

  // Status options for the dropdown — union of both teams (or the manager's
  // team only). Keeps the picker honest to what a lead can actually be.
  const statusOptions = me.role === "MANAGER" && normalizeTeam(me.team ?? undefined)
    ? statusesForTeam(normalizeTeam(me.team ?? undefined))
    : statusesForTeam(null); // ALL_STATUSES union

  const sections = [
    {
      key: "fresh" as const,
      title: "🆕 FRESH — CONTACT FIRST",
      caption: "Assigned today · no call, WhatsApp, or note logged yet.",
      accent: "border-l-red-500",
      tint: "bg-red-50/60",
      items: freshUntouched.map((l) => makeCard(l, "fresh")),
    },
    {
      key: "ready_close" as const,
      title: "💎 READY TO CLOSE",
      caption: "High-priority leads — push for booking today.",
      accent: "border-l-emerald-500",
      tint: "bg-emerald-50/60",
      items: readyToClose.map((l) => makeCard(l, "ready_close")),
    },
    {
      key: "needs_you" as const,
      title: "🚩 NEED YOUR ATTENTION",
      caption: "Flagged for manager push.",
      accent: "border-l-amber-500",
      tint: "bg-amber-50/60",
      items: needsYou.map((l) => makeCard(l, "needs_you")),
    },
  ];

  // Follow-up cards get the overdue flagKind when their date is in the past so
  // the urgent-glow + "Nd overdue" chip still fire; otherwise a neutral kind.
  const todayStart = istDayRange().start;
  const followupCards: CardData[] = followups.map((l) =>
    makeCard(l, l.followupDate && l.followupDate < todayStart ? "overdue" : "followup"),
  );

  const anyFilter = !!(agentFilter || teamFilter || statusFilter);

  // Helper: preserve the current filters when switching the date tab.
  function tabHref(nextWhen: WhenKey): string {
    const p = new URLSearchParams();
    p.set("when", nextWhen);
    if (agentFilter) p.set("agent", agentFilter);
    if (teamFilter) p.set("team", teamFilter);
    if (statusFilter) p.set("status", statusFilter);
    return `/action-list?${p.toString()}`;
  }

  const tabs: Array<{ key: WhenKey; label: string }> = [
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "overdue", label: "Overdue" },
  ];

  function buildWaDraft(card: CardData): string {
    const firstName = card.name.split(" ")[0];
    const team = card.team ?? "Dubai";
    const budgetStr = card.budget.min ? formatBudget(card.budget.min, card.budget.currency) : null;
    const config = card.configuration;

    // Build personalised opening lines
    const parts: string[] = [];

    if (budgetStr && config) {
      parts.push(`You were exploring a ${config} ${team} property around ${budgetStr}.`);
    } else if (budgetStr) {
      parts.push(`You were looking at ${team} investment options around ${budgetStr}.`);
    } else if (config) {
      parts.push(`You had shown interest in a ${config} in ${team}.`);
    } else {
      parts.push(`You were exploring ${team} investment options.`);
    }

    if (card.needSummary && card.needSummary.length < 80) {
      parts.push(`Your requirement: ${card.needSummary}.`);
    }

    parts.push("I can shortlist 2–3 suitable options based on your preference. Would it be convenient to connect briefly today?");

    return `Hi ${firstName}, as discussed, ${parts.join(" ")}\n\n– ${card.ownerName ?? "White Collar Realty Team"} | White Collar Realty`;
  }

  // Shared card renderer (used by the follow-up board AND the two context sections).
  function renderCard(card: CardData, accent: string, tint: string) {
    const ns = aiNextStep(card);
    const greet = buildWaDraft(card);
    const waLink = card.phone ? waDraftLink(card.phone, greet) : "";

    const overdueHours = hoursOverdue(card.followupDate);
    const glow = card.flagKind === "overdue" && overdueHours >= 24
      ? "wcr-urgent-glow"
      : card.flagKind === "ready_close"
        ? "wcr-hot-glow"
        : "";

    return (
      <div key={card.id} className={`card p-4 border-l-4 ${accent} ${tint} ${glow}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/leads/${card.id}`} className="font-bold text-[#0b1a33] hover:underline">{card.name}</Link>
              <span className="text-xs text-gray-500 dark:text-slate-400">{card.phone}</span>
              {card.team && <span className={`chip ${card.team === "India" ? "src-csv" : "src-wa"}`}>{card.team}</span>}
              {card.currentStatus
                ? <span className="chip src">{card.currentStatus}</span>
                : <span className="chip chip-warm">{card.status.replaceAll("_"," ")}</span>}
              {card.flagKind === "overdue" && overdueHours > 0 && (
                <span className="chip" style={{ background: overdueHours >= 24 ? "#fee2e2" : "#fef3c7", color: overdueHours >= 24 ? "#991b1b" : "#92400e" }}>
                  {overdueHours < 24 ? `${overdueHours}h overdue` : `${Math.round(overdueHours/24)}d overdue`}
                </span>
              )}
              {card.flagKind === "followup" && card.followupDate && (
                <span className="chip" style={{ background: "#e0f2fe", color: "#075985" }}>
                  ⏰ {new Date(card.followupDate).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Owner: {card.ownerName ?? "—"} · Last touch: {card.lastTouchedAt ? formatDistanceToNow(card.lastTouchedAt, { addSuffix: true }) : "never"} · {fmtAEDInr(card.budget.min, card.budget.currency)}
            </div>
          </div>
        </div>

        {lastMeaningfulRemark(card.remarks) && (
          <div className="mt-3 text-xs">
            <div className="font-bold text-gray-600 dark:text-slate-300 mb-1">LATEST REMARK</div>
            <div className="text-gray-700 dark:text-slate-300 line-clamp-2">{lastMeaningfulRemark(card.remarks)}</div>
          </div>
        )}

        <div className="mt-3 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 text-sm dark:text-slate-200">
          <b>Next step:</b> {ns.step}
        </div>
        <div className="mt-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 text-xs dark:text-slate-200">
          <b>Why you:</b> {ns.why}
          {card.needsManagerReason && <div className="text-amber-700 dark:text-yellow-300 mt-1">⚠ {card.needsManagerReason}</div>}
        </div>

        {card.phone && (
          <div className="mt-3 p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-xs dark:text-slate-200">
            <b>WhatsApp draft:</b> <span className="text-gray-700 dark:text-slate-300">{greet}</span>
          </div>
        )}

        {/* The interactive bar — Complete / Snooze / Escalate plus the
            existing Call + WhatsApp shortcuts. */}
        <ActionCardClient
          leadId={card.id}
          leadName={card.name}
          phone={card.phone}
          waLink={waLink}
          flagKind={card.flagKind === "followup" ? "overdue" : card.flagKind === "fresh" ? "needs_you" : card.flagKind}
          hasContactToday={contactByLead.has(card.id)}
        />

        <div className="mt-2 text-right">
          <Link href={`/leads/${card.id}`} className="text-xs text-gray-500 dark:text-slate-400 hover:underline">Full history →</Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Glow-pulse keyframes for urgent cards (NEGOTIATION + 24h+ overdue).
          We inline the <style> on the page rather than globals.css because:
          – it's the only place that uses these keyframes,
          – it co-locates with the cards that reference it (easier to find/tweak). */}
      <style>{`
        @keyframes wcr-urgent-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.40), 0 1px 2px rgba(0,0,0,0.06); }
          50%      { box-shadow: 0 0 0 6px rgba(239,68,68,0.00), 0 1px 2px rgba(0,0,0,0.06); }
        }
        @keyframes wcr-hot-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.40), 0 1px 2px rgba(0,0,0,0.06); }
          50%      { box-shadow: 0 0 0 6px rgba(16,185,129,0.00), 0 1px 2px rgba(0,0,0,0.06); }
        }
        .wcr-urgent-glow { animation: wcr-urgent-pulse 2.4s ease-in-out infinite; }
        .wcr-hot-glow    { animation: wcr-hot-pulse    2.4s ease-in-out infinite; }
      `}</style>

      <div>
        <h1 className="text-xl sm:text-2xl font-bold">
          {me.role === "AGENT" ? "📋 Your Action List" : `📋 ${me.name.split(" ")[0]}'s Action List (${me.role === "ADMIN" ? "Admin view — all teams" : "Manager view"})`}
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          {me.role === "AGENT"
            ? "Every follow-up due — pick a day, then ✅ Complete, ⏸ Snooze, or 🆘 Escalate on each card."
            : "Team-wide follow-up board. Each agent sees the same view filtered to their own leads when they log in."}
        </p>
      </div>

      {/* ── FOLLOW-UPS BOARD (primary) — date tabs + Agent/Team/Status filters ── */}
      <section>
        {/* Date tabs */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          {tabs.map((t) => {
            const active = effectiveWhen === t.key;
            return (
              <Link
                key={t.key}
                href={tabHref(t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                  active
                    ? "bg-[#0b1a33] text-white border-[#0b1a33]"
                    : "bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
          {/* Custom date — submits ?date=YYYY-MM-DD (sets when=date). Preserves filters. */}
          <form method="get" action="/action-list" className="flex items-center gap-1">
            <input type="hidden" name="when" value="date" />
            {agentFilter && <input type="hidden" name="agent" value={agentFilter} />}
            {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <input
              type="date"
              name="date"
              defaultValue={effectiveWhen === "date" ? dateKey : ""}
              className={`border rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-slate-100 ${
                effectiveWhen === "date" ? "border-[#0b1a33] dark:border-blue-400 font-semibold" : "border-gray-300 dark:border-slate-600"
              }`}
            />
            <button type="submit" className="btn btn-ghost text-xs">Go</button>
          </form>
        </div>

        {/* Agent / Team / Status filters — combine with the active date tab. */}
        <form method="get" action="/action-list" className="card p-3 mb-3">
          <input type="hidden" name="when" value={effectiveWhen} />
          {effectiveWhen === "date" && <input type="hidden" name="date" value={dateKey} />}
          <div className="flex flex-wrap gap-3 items-end">
            {me.role !== "AGENT" && (
              <div className="flex flex-col gap-1 min-w-[150px]">
                <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Agent</label>
                <select name="agent" defaultValue={agentFilter ?? ""} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
                  <option value="">All agents</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.team ? ` (${a.team})` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            {me.role === "ADMIN" && (
              <div className="flex flex-col gap-1 min-w-[120px]">
                <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Team</label>
                <select name="team" defaultValue={teamFilter ?? ""} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
                  <option value="">All teams</option>
                  {TEAMS.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
            )}
            <div className="flex flex-col gap-1 min-w-[160px]">
              <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Status</label>
              <select name="status" defaultValue={statusFilter ?? ""} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100">
                <option value="">All statuses</option>
                {statusOptions.map((s) => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Apply</button>
              {anyFilter && (
                <Link href={tabHref(effectiveWhen)} className="btn btn-ghost">Clear filters</Link>
              )}
            </div>
          </div>
        </form>

        {/* Section header — count == records (both use followupWhere). */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="font-bold text-base">
            {effectiveWhen === "today" && "📆 TODAY'S FOLLOW-UPS"}
            {effectiveWhen === "tomorrow" && "📆 TOMORROW'S FOLLOW-UPS"}
            {effectiveWhen === "overdue" && "⏰ OVERDUE FOLLOW-UPS"}
            {effectiveWhen === "date" && `📆 FOLLOW-UPS · ${dateKey}`}
          </h2>
          <span className="text-sm text-gray-500 dark:text-slate-400">{followupCount}</span>
          <span className="text-xs text-gray-400 dark:text-slate-500 hidden sm:inline">— {windowLabel}{anyFilter ? " (filtered)" : ""}, all statuses</span>
        </div>

        {followupCards.length === 0 ? (
          <div className="text-sm text-gray-500 dark:text-slate-400 italic px-1">
            No follow-ups {effectiveWhen === "overdue" ? "overdue" : effectiveWhen === "tomorrow" ? "for tomorrow" : effectiveWhen === "date" ? `on ${dateKey}` : "due today"}{anyFilter ? " matching these filters" : ""}.
          </div>
        ) : (
          <div className="space-y-3">
            {followupCards.map((card) =>
              renderCard(card, card.flagKind === "overdue" ? "border-l-red-500" : "border-l-sky-500", card.flagKind === "overdue" ? "bg-red-50/60" : "bg-sky-50/40"),
            )}
          </div>
        )}
      </section>

      {/* ── Secondary context sections (only when not filtering) ── */}
      {!anyFilter && sections.map((sec) => (
        <section key={sec.key}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="font-bold text-base">{sec.title}</h2>
            <span className="text-sm text-gray-500 dark:text-slate-400">{sec.items.length}</span>
            {sec.caption && <span className="text-xs text-gray-400 dark:text-slate-500 hidden sm:inline">— {sec.caption}</span>}
          </div>
          {sec.items.length === 0 ? (
            <div className="text-sm text-gray-500 dark:text-slate-400 italic px-1">Nothing here — good job, or check back later.</div>
          ) : (
            <div className="space-y-3">
              {sec.items.map((card) => renderCard(card, sec.accent, sec.tint))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

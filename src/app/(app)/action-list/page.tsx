import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SUPPRESSED_STATUSES, CLOSING_STATUSES } from "@/lib/lead-statuses";
import { formatBudget } from "@/lib/budgetParse";
import { formatDistanceToNow } from "date-fns";
import { runReconciler } from "@/lib/reconciler";
import { ACTIVE_ORIGINS } from "@/lib/leadScope";
import { waDraftLink } from "@/lib/wa";
import Link from "next/link";
import ActionCardClient from "@/components/ActionCardClient";
import { lastMeaningfulRemark } from "@/lib/needSnapshot";
import { formatLeadName } from "@/lib/leadName";

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
  flagKind: "ready_close" | "overdue" | "needs_you";
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
  const { status, todoNext, aiNextAction, budget, needSummary, configuration, whenCanInvest, potential, team: forwardedTeam, remarks, followupDate } = card;
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

export default async function ActionListPage() {
  const me = await requireUser();
  runReconciler().catch(() => {});

  // Scope: Admin/Manager see all; Agent sees only own
  const scope = me.role === "AGENT" ? { ownerId: me.id } : {};

  const activeScope = { ...scope, deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS } };
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

  const [readyToClose, overdue, needsYou] = await Promise.all([
    prisma.lead.findMany({
      where: { ...activeScope, currentStatus: { in: CLOSING_STATUSES } },
      orderBy: { lastTouchedAt: "desc" },
      take: 10,
      select: leadSelect,
    }),
    prisma.lead.findMany({
      where: { ...activeScope, followupDate: { lt: new Date() }, currentStatus: { notIn: SUPPRESSED_STATUSES } },
      orderBy: { followupDate: "asc" },
      take: 20,
      select: leadSelect,
    }),
    prisma.lead.findMany({
      where: { ...activeScope, needsManagerReview: true, currentStatus: { notIn: SUPPRESSED_STATUSES } },
      orderBy: { flaggedAt: "desc" },
      take: 15,
      select: leadSelect,
    }),
  ]);

  const sections = [
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
    {
      key: "overdue" as const,
      title: "⏰ FOLLOW-UPS OVERDUE",
      caption: "These slipped past their date — call first.",
      accent: "border-l-red-500",
      tint: "bg-red-50/60",
      items: overdue.map((l) => makeCard(l, "overdue")),
    },
  ];

  const totalUrgent =
    sections.find(s => s.key === "ready_close")!.items.length +
    sections.find(s => s.key === "overdue")!.items.filter(c => hoursOverdue(c.followupDate) >= 24).length +
    sections.find(s => s.key === "needs_you")!.items.length;

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
            ? "Your top priorities right now — close these first. Use ✅ Complete, ⏸ Snooze, or 🆘 Escalate on each card."
            : "Team-wide priority cards. Each agent sees the same view filtered to their own leads when they log in."}
          {totalUrgent > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-rose-600 font-semibold">
              · {totalUrgent} urgent
            </span>
          )}
        </p>
      </div>

      {sections.map((sec) => (
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
              {sec.items.map((card) => {
                const ns = aiNextStep(card);
                const greet = buildWaDraft(card);
                const waLink = card.phone ? waDraftLink(card.phone, greet) : "";

                // Urgent-glow rules:
                //   • Overdue ≥24h     → red pulse (don't drop the ball further)
                //   • Ready-to-close   → green pulse (closing window is open NOW)
                //   • Needs-you flag   → no pulse, the amber border tells the story
                const overdueHours = hoursOverdue(card.followupDate);
                const glow = card.flagKind === "overdue" && overdueHours >= 24
                  ? "wcr-urgent-glow"
                  : card.flagKind === "ready_close"
                    ? "wcr-hot-glow"
                    : "";

                return (
                  <div key={card.id} className={`card p-4 border-l-4 ${sec.accent} ${sec.tint} ${glow}`}>
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
                      flagKind={card.flagKind}
                    />

                    <div className="mt-2 text-right">
                      <Link href={`/leads/${card.id}`} className="text-xs text-gray-500 dark:text-slate-400 hover:underline">Full history →</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

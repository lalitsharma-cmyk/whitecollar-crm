import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadStatus } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import { runReconciler } from "@/lib/reconciler";
import { waDraftLink, WA_TEMPLATES } from "@/lib/wa";
import Link from "next/link";
import ActionCardClient from "@/components/ActionCardClient";

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
}

function fmtAEDInr(min: number | null, currency: string) {
  if (!min) return "—";
  if (currency === "INR") return `₹ ${(min/1e7).toFixed(1)} Cr`;
  return `AED ${(min/1e6).toFixed(1)} M`;
}

// AI reason text per stage (the master spec § 9.2 calls for "AI reason text"
// on each card so the agent understands at a glance why this card is on top).
function aiNextStep(status: string, todoNext: string | null, aiNext: string | null): { step: string; why: string } {
  if (status === "NEGOTIATION") return {
    step: "🔥 CLOSE NOW: buying signals are showing — push for booking/token and confirm payment plan.",
    why: "Closing stage — a manager push can win the deal.",
  };
  if (status === "SITE_VISIT") return {
    step: aiNext ?? "Confirm the site visit slot and send the latest brochure/payment plan.",
    why: "Site visit booked — momentum, don't let it slip.",
  };
  if (status === "QUALIFIED") return {
    step: aiNext ?? todoNext ?? "Schedule office meeting or site visit — they're ready to evaluate.",
    why: "Qualified — next step is to lock a visit.",
  };
  if (status === "CONTACTED") return {
    step: todoNext ?? "Re-engage with project-specific info or a personalised question.",
    why: "Contacted but no progress in 24h+ — manager touch helps.",
  };
  return {
    step: todoNext ?? aiNext ?? "Make first call within the hour.",
    why: "New / idle — gentle nudge from manager.",
  };
}

function makeCard(l: any, flagKind: CardData["flagKind"]): CardData {
  return {
    id: l.id, name: l.name, phone: l.phone,
    team: l.forwardedTeam, ownerName: l.owner?.name ?? null,
    lastTouchedAt: l.lastTouchedAt,
    followupDate: l.followupDate,
    status: l.status, currentStatus: l.currentStatus,
    todoNext: l.todoNext, aiNextAction: l.aiNextAction,
    remarks: l.remarks, whoIsClient: l.whoIsClient,
    budget: { min: l.budgetMin, max: l.budgetMax, currency: l.budgetCurrency ?? "AED" },
    needsManagerReason: l.managerReviewReason,
    flagKind,
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

  const [readyToClose, overdue, needsYou] = await Promise.all([
    prisma.lead.findMany({
      where: { ...scope, status: { in: [LeadStatus.NEGOTIATION, LeadStatus.SITE_VISIT] } },
      orderBy: { lastTouchedAt: "desc" },
      take: 10,
      include: { owner: true },
    }),
    prisma.lead.findMany({
      where: { ...scope, followupDate: { lt: new Date() }, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
      orderBy: { followupDate: "asc" },
      take: 20,
      include: { owner: true },
    }),
    prisma.lead.findMany({
      where: { ...scope, needsManagerReview: true, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
      orderBy: { flaggedAt: "desc" },
      take: 15,
      include: { owner: true },
    }),
  ]);

  const sections = [
    {
      key: "ready_close" as const,
      title: "🔥 READY TO CLOSE",
      caption: "Push these over the line today.",
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
        <p className="text-xs sm:text-sm text-gray-500">
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
            <span className="text-sm text-gray-500">{sec.items.length}</span>
            {sec.caption && <span className="text-xs text-gray-400 hidden sm:inline">— {sec.caption}</span>}
          </div>
          {sec.items.length === 0 ? (
            <div className="text-sm text-gray-500 italic px-1">Nothing here — good job, or check back later.</div>
          ) : (
            <div className="space-y-3">
              {sec.items.map((card) => {
                const ns = aiNextStep(card.status, card.todoNext, card.aiNextAction);
                const greet = WA_TEMPLATES.followupEN(card.name.split(" ")[0]);
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
                          <span className="text-xs text-gray-500">{card.phone}</span>
                          {card.team && <span className={`chip ${card.team === "India" ? "src-csv" : "src-wa"}`}>{card.team}</span>}
                          <span className="chip chip-warm">{card.status.replaceAll("_"," ")}</span>
                          {card.currentStatus && <span className="chip src">{card.currentStatus}</span>}
                          {card.flagKind === "overdue" && overdueHours > 0 && (
                            <span className="chip" style={{ background: overdueHours >= 24 ? "#fee2e2" : "#fef3c7", color: overdueHours >= 24 ? "#991b1b" : "#92400e" }}>
                              {overdueHours < 24 ? `${overdueHours}h overdue` : `${Math.round(overdueHours/24)}d overdue`}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          Owner: {card.ownerName ?? "—"} · Last touch: {card.lastTouchedAt ? formatDistanceToNow(card.lastTouchedAt, { addSuffix: true }) : "never"} · {fmtAEDInr(card.budget.min, card.budget.currency)}
                        </div>
                      </div>
                    </div>

                    {card.remarks && (
                      <div className="mt-3 text-xs">
                        <div className="font-bold text-gray-600 mb-1">LATEST REMARK</div>
                        <div className="text-gray-700 whitespace-pre-wrap line-clamp-2">{card.remarks}</div>
                      </div>
                    )}

                    <div className="mt-3 p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
                      <b>Next step:</b> {ns.step}
                    </div>
                    <div className="mt-2 p-2 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                      <b>Why you:</b> {ns.why}
                      {card.needsManagerReason && <div className="text-amber-700 mt-1">⚠ {card.needsManagerReason}</div>}
                    </div>

                    {card.phone && (
                      <div className="mt-3 p-2 rounded-lg bg-blue-50 border border-blue-200 text-xs">
                        <b>WhatsApp draft:</b> <span className="text-gray-700">{greet}</span>
                      </div>
                    )}

                    {/* The interactive bar — Complete / Snooze / Escalate plus the
                        existing Call + WhatsApp shortcuts. Awards XP on Complete. */}
                    <ActionCardClient
                      leadId={card.id}
                      leadName={card.name}
                      phone={card.phone}
                      waLink={waLink}
                      flagKind={card.flagKind}
                    />

                    <div className="mt-2 text-right">
                      <Link href={`/leads/${card.id}`} className="text-xs text-gray-500 hover:underline">Full history →</Link>
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

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { AIScore, LeadStatus, ActivityType } from "@prisma/client";

// "Smart suggestions" — rule-based daily nudges for an agent / manager / admin.
//
// Pure server component, runs as part of the dashboard render. Each rule is a
// cheap COUNT (or a tiny findFirst for the "no CallLog" case) and they all
// fan out via Promise.all so the widget doesn't add a serial latency tax to
// the dashboard.
//
// The widget hides itself when no rule yields a non-zero count — we don't
// want empty placeholder UI on a clean day.

type Suggestion = {
  key: string;
  emoji: string;
  headline: string;
  count: number;
  href: string;
  tone: "red" | "amber" | "emerald" | "blue" | "violet" | "slate";
};

interface Props {
  userId: string;
  role: string;
  team: string | null;
}

// High-budget thresholds — match the "closable money" rule in the spec.
// Dubai team thinks in AED, India team thinks in INR; falling back to the
// AED number for "all" / unknown teams keeps the bar high enough to be
// meaningful for either market.
const HIGH_BUDGET_AED = 5_000_000;   // 5M AED
const HIGH_BUDGET_INR = 30_000_000;  // 3 Cr INR

export default async function SmartSuggestionsCard({ userId, role, team }: Props) {
  const isAdmin = role === "ADMIN";
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000);

  // Pick the threshold by the user's team so the "high-budget" rules are
  // meaningful in the local currency. "all"/HQ falls back to AED.
  const highBudget = team === "India" ? HIGH_BUDGET_INR : HIGH_BUDGET_AED;

  const ownerScope = { ownerId: userId };
  const liveStatus = { status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } };

  const [
    hotRevival,
    closableMoney,
    highValueGhosting,
    stuckNegotiations,
    unreadNotifs,
    staleWorkflows,
    hotNotCalled,
    recentlyHot,
  ] = await Promise.all([
    // 1) Hot revival — HOT-scored cold leads dormant 30+ days.
    prisma.lead.count({
      where: {
        ...ownerScope,
        aiScore: AIScore.HOT,
        isColdCall: true,
        lastTouchedAt: { lt: thirtyDaysAgo },
        ...liveStatus,
      },
    }),
    // 2) Closable money — NEGOTIATION + budget over high threshold.
    prisma.lead.count({
      where: {
        ...ownerScope,
        status: LeadStatus.NEGOTIATION,
        budgetMin: { gte: highBudget },
      },
    }),
    // 3) High-value untouched — budget over threshold AND not touched in 7d.
    prisma.lead.count({
      where: {
        ...ownerScope,
        budgetMin: { gte: highBudget },
        lastTouchedAt: { lt: sevenDaysAgo },
        ...liveStatus,
      },
    }),
    // 4) Stuck negotiations — NEGOTIATION + no touch in 5d.
    prisma.lead.count({
      where: {
        ...ownerScope,
        status: LeadStatus.NEGOTIATION,
        lastTouchedAt: { lt: fiveDaysAgo },
      },
    }),
    // 5) Unread notifications — recipient is the viewer, readAt null.
    prisma.notification.count({
      where: { userId, readAt: null },
    }),
    // 6) Workflows that haven't fired — admin only. Active workflows with no
    //    run in the past 7 days. Count of Workflow rows where NOT EXISTS run
    //    within window, via `runs: { none: { ... } }`.
    isAdmin
      ? prisma.workflow.count({
          where: {
            active: true,
            runs: { none: { createdAt: { gte: sevenDaysAgo } } },
          },
        })
      : Promise.resolve(0),
    // 7) Hot lead not yet called — HOT-scored lead the agent owns with zero
    //    CallLog rows. Postgres handles `callLogs: { none: {} }` efficiently
    //    via an anti-join.
    prisma.lead.count({
      where: {
        ...ownerScope,
        aiScore: AIScore.HOT,
        ...liveStatus,
        callLogs: { none: {} },
      },
    }),
    // 8) Recently became hot — HOT-scored leads whose lastTouchedAt landed
    //    inside the last 24h (proxy for "score flipped recently" without
    //    needing a STATUS_CHANGE activity scan).
    prisma.lead.count({
      where: {
        ...ownerScope,
        aiScore: AIScore.HOT,
        ...liveStatus,
        lastTouchedAt: { gte: oneDayAgo },
      },
    }),
  ]);

  // Build the candidate list IN PRIORITY ORDER, then keep the first 5 that
  // have a non-zero count. Tone colours come from a fixed palette so the
  // widget reads at a glance.
  const candidates: Suggestion[] = [
    {
      key: "hot_revival",
      emoji: "🔥",
      headline: `${hotRevival} HOT cold lead${hotRevival === 1 ? "" : "s"} dormant 30+ days`,
      count: hotRevival,
      href: "/leads?ai=HOT&showCold=true",
      tone: "red",
    },
    {
      key: "closable_money",
      emoji: "💎",
      headline: `${closableMoney} deal${closableMoney === 1 ? "" : "s"} in negotiation over ${
        team === "India" ? "3 Cr INR" : "5M AED"
      }`,
      count: closableMoney,
      href: "/leads?smart=visit_potential",
      tone: "emerald",
    },
    {
      key: "high_value_ghosting",
      emoji: "👻",
      headline: `${highValueGhosting} high-budget lead${highValueGhosting === 1 ? "" : "s"} not contacted in 7d`,
      count: highValueGhosting,
      href: "/leads?smart=ghosting&smart=high_budget",
      tone: "amber",
    },
    {
      key: "stuck_negotiations",
      emoji: "⏳",
      headline: `${stuckNegotiations} negotiation${stuckNegotiations === 1 ? "" : "s"} stuck 5+ days`,
      count: stuckNegotiations,
      href: "/leads?status=NEGOTIATION",
      tone: "amber",
    },
    {
      key: "unread_notifs",
      emoji: "🔔",
      headline: `${unreadNotifs} unread notification${unreadNotifs === 1 ? "" : "s"}`,
      count: unreadNotifs,
      href: "/notifications",
      tone: "blue",
    },
    ...(isAdmin
      ? [
          {
            key: "stale_workflows",
            emoji: "⚙️",
            headline: `${staleWorkflows} workflow${staleWorkflows === 1 ? "" : "s"} haven't fired in 7d`,
            count: staleWorkflows,
            href: "/admin/workflows",
            tone: "slate" as const,
          },
        ]
      : []),
    {
      key: "hot_not_called",
      emoji: "📞",
      headline: `${hotNotCalled} HOT lead${hotNotCalled === 1 ? "" : "s"} never called`,
      count: hotNotCalled,
      href: "/leads?ai=HOT&followup=overdue",
      tone: "red",
    },
    {
      key: "recently_hot",
      emoji: "✨",
      headline: `${recentlyHot} lead${recentlyHot === 1 ? "" : "s"} became HOT in last 24h`,
      count: recentlyHot,
      href: "/leads?ai=HOT&when=24h",
      tone: "violet",
    },
  ];

  // Avoid an unused-import warning — ActivityType is intentionally imported
  // so future rules (e.g. STATUS_CHANGE-based "recently hot") can be wired
  // in without re-importing. Reference it cheaply at module level.
  void ActivityType;

  const picks = candidates.filter((s) => s.count > 0).slice(0, 5);

  if (picks.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">💡</span>
        <div className="font-semibold text-sm">Smart suggestions</div>
        <span className="text-[10px] text-gray-500">
          Auto-surfaced from your pipeline · {picks.length} {picks.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="space-y-1.5">
        {picks.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${toneBorder(s.tone)} ${toneBg(
              s.tone,
            )} hover:shadow-sm hover:border-[#c9a24b] transition`}
          >
            <span className="text-base flex-none">{s.emoji}</span>
            <span className="text-sm font-medium text-[#0b1a33] flex-1 min-w-0 truncate">
              {s.headline}
            </span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full flex-none ${toneBadge(s.tone)}`}>
              {s.count}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function toneBorder(tone: Suggestion["tone"]): string {
  switch (tone) {
    case "red": return "border-red-200";
    case "amber": return "border-amber-200";
    case "emerald": return "border-emerald-200";
    case "blue": return "border-blue-200";
    case "violet": return "border-violet-200";
    case "slate": return "border-slate-200";
  }
}

function toneBg(tone: Suggestion["tone"]): string {
  switch (tone) {
    case "red": return "bg-red-50/60";
    case "amber": return "bg-amber-50/60";
    case "emerald": return "bg-emerald-50/60";
    case "blue": return "bg-blue-50/60";
    case "violet": return "bg-violet-50/60";
    case "slate": return "bg-slate-50/60";
  }
}

function toneBadge(tone: Suggestion["tone"]): string {
  switch (tone) {
    case "red": return "bg-red-100 text-red-800 border border-red-300";
    case "amber": return "bg-amber-100 text-amber-900 border border-amber-300";
    case "emerald": return "bg-emerald-100 text-emerald-900 border border-emerald-300";
    case "blue": return "bg-blue-100 text-blue-900 border border-blue-300";
    case "violet": return "bg-violet-100 text-violet-900 border border-violet-300";
    case "slate": return "bg-slate-100 text-slate-900 border border-slate-300";
  }
}

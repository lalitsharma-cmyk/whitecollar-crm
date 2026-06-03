import { prisma } from "@/lib/prisma";
import { LeadStatus, AIScore, ActivityType, Prisma } from "@prisma/client";
import KanbanBoard from "@/components/KanbanBoard";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";

export const dynamic = "force-dynamic";

// Active-pipeline-only — Lalit asked to remove Won + Lost columns. Won deals
// stop being tracked here (they move to reports); Lost ones drop off entirely.
// The enum values still exist on Lead.status so any historical data is preserved.
const stages = [
  { key: LeadStatus.NEW,          label: "New" },
  { key: LeadStatus.CONTACTED,    label: "Contacted" },
  { key: LeadStatus.QUALIFIED,    label: "Qualified" },
  { key: LeadStatus.SITE_VISIT,   label: "Site Visit" },
  { key: LeadStatus.NEGOTIATION,  label: "Negotiation" },
  { key: LeadStatus.BOOKING_DONE, label: "Booking Done" },
];

// §9.7 Momentum/risk thresholds — calibrated to the team's rhythm.
//   Healthy   ≤ 3 days in stage
//   Slowing   ≤ 7 days
//   Stuck     > 7 days
// "Untouched since entering stage" is a separate red flag — if a lead has
// been in NEGOTIATION for 4 days but the agent has zero activity, that's
// worse than a lead that's been in NEGOTIATION for 6 days with daily calls.
const DAYS_HEALTHY = 3;
const DAYS_STUCK   = 7;

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  // Ownership scope: AGENT → own leads only, MANAGER → own + reports, ADMIN → all.
  // Without this an agent could open /pipeline and see every company lead.
  const scope = await leadScopeWhere(me);
  const where: Prisma.LeadWhereInput = { ...scope, status: { in: stages.map(s => s.key) } };
  if (sp.team) where.forwardedTeam = sp.team;
  // Only ADMIN/MANAGER may override ownership via ?owner=. Agents stay locked to
  // their own scope — otherwise ?owner=<peerId> would leak a colleague's pipeline.
  if (me.role !== "AGENT") {
    if (sp.owner === "unassigned") where.ownerId = null;
    else if (sp.owner) where.ownerId = sp.owner;
  }
  if (sp.ai) where.aiScore = sp.ai as AIScore;

  const [leads, agents] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300, // B-15: bound the previously-unbounded pipeline query (>current ~45 leads, so no visible truncation; forward-looking guard)
      include: {
        owner: { select: { name: true, avatarColor: true } }, // B-15: only name+avatar rendered
        interestedUnits: { take: 1, select: { unit: { select: { project: { select: { name: true } } } } } }, // B-15: only project.name rendered
        // Pull the most recent STATUS_CHANGE so we know when this lead
        // entered its current stage. Falls back to lead.updatedAt if there's
        // never been a change (eg. brand-new lead in NEW). One row per lead
        // is plenty — newest first via the relation's natural orderBy.
        activities: {
          where: { type: ActivityType.STATUS_CHANGE },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, title: true },
        },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
  ]);

  const now = Date.now();
  const leadsByStage: Record<string, any[]> = {};
  for (const s of stages) leadsByStage[s.key] = [];

  for (const l of leads) {
    // Time in current stage — prefer the most recent STATUS_CHANGE timestamp,
    // fall back to createdAt (a brand-new NEW lead that's never moved).
    const enteredStageAt = l.activities[0]?.createdAt ?? l.createdAt;
    const daysInStage = Math.max(0, Math.floor((now - enteredStageAt.getTime()) / 86_400_000));

    // Momentum bucket — used for both color + sorting later if we wanted.
    const momentum: "healthy" | "slowing" | "stuck" =
      daysInStage <= DAYS_HEALTHY ? "healthy" :
      daysInStage <= DAYS_STUCK   ? "slowing" : "stuck";

    // Risk flags — small array of human-readable warnings, surfaced as tiny
    // chips on the card. Card is "at risk" if any of these are non-empty.
    const risks: string[] = [];
    if (momentum === "stuck") {
      risks.push(`Stuck ${daysInStage}d in ${l.status.replaceAll("_", " ")}`);
    }
    // Untouched since entering this stage — even worse than the above.
    if (
      (l.status === LeadStatus.NEGOTIATION || l.status === LeadStatus.SITE_VISIT || l.status === LeadStatus.QUALIFIED) &&
      (!l.lastTouchedAt || l.lastTouchedAt < enteredStageAt)
    ) {
      risks.push("No activity since stage change");
    }
    // Hot + stuck = highest priority red flag
    if (l.aiScore === AIScore.HOT && momentum === "stuck") {
      risks.push("HOT lead going cold");
    }
    // Manager flag still pending = visible risk
    if (l.needsManagerReview) {
      risks.push("Awaiting manager review");
    }

    const card = {
      id: l.id, name: l.name,
      configuration: l.configuration,
      budgetMin: l.budgetMin, budgetCurrency: l.budgetCurrency,
      ownerName: l.owner?.name ?? null, ownerAvatar: l.owner?.avatarColor ?? null,
      team: l.forwardedTeam,
      aiScore: l.aiScore, aiScoreValue: l.aiScoreValue,
      projectName: l.interestedUnits[0]?.unit.project.name ?? null,
      // §9.7 additions
      daysInStage,
      momentum,
      risks,
    };
    if (leadsByStage[l.status]) leadsByStage[l.status].push(card);
  }

  // Sort each stage so risky/stuck cards float to the TOP — the spec is clear
  // that the pipeline should be action-first, not creation-date-first.
  const riskScore = (c: any) =>
    (c.risks?.length ?? 0) * 100 +
    (c.momentum === "stuck" ? 50 : c.momentum === "slowing" ? 20 : 0) +
    Math.min(c.daysInStage ?? 0, 30);
  for (const key of Object.keys(leadsByStage)) {
    leadsByStage[key].sort((a, b) => riskScore(b) - riskScore(a));
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {leads.length} leads · <span className="hidden sm:inline">drag a card to change its stage — you'll be asked what changed</span><span className="sm:hidden">tap ↕ Move Stage on a card to change stage, or tap the card name to open it</span>
          </p>
        </div>
        <div className="seg self-start">
          <button className="on">Kanban</button>
          <Link href="/leads">List</Link>
        </div>
      </div>

      <KanbanBoard
        stages={stages.map(s => ({ key: s.key, label: s.label }))}
        leadsByStage={leadsByStage}
        agents={agents.map(a => ({ id: a.id, name: a.name }))}
      />
    </>
  );
}

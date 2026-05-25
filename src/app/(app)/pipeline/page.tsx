import { prisma } from "@/lib/prisma";
import { LeadStatus, AIScore, Prisma } from "@prisma/client";
import KanbanBoard from "@/components/KanbanBoard";
import Link from "next/link";

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

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const where: Prisma.LeadWhereInput = { status: { in: stages.map(s => s.key) } };
  if (sp.team) where.forwardedTeam = sp.team;
  if (sp.owner === "unassigned") where.ownerId = null;
  else if (sp.owner) where.ownerId = sp.owner;
  if (sp.ai) where.aiScore = sp.ai as AIScore;

  const [leads, agents] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
    prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } }),
  ]);

  const leadsByStage: Record<string, any[]> = {};
  for (const s of stages) leadsByStage[s.key] = [];
  for (const l of leads) {
    const card = {
      id: l.id, name: l.name,
      configuration: l.configuration,
      budgetMin: l.budgetMin, budgetCurrency: l.budgetCurrency,
      ownerName: l.owner?.name ?? null, ownerAvatar: l.owner?.avatarColor ?? null,
      team: l.forwardedTeam,
      aiScore: l.aiScore, aiScoreValue: l.aiScoreValue,
      projectName: l.interestedUnits[0]?.unit.project.name ?? null,
    };
    if (leadsByStage[l.status]) leadsByStage[l.status].push(card);
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            {leads.length} leads · <span className="hidden sm:inline">drag a card to change its stage</span><span className="sm:hidden">tap a lead to open it (use desktop to drag)</span>
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

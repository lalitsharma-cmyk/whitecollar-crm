import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import KanbanClient from "@/components/KanbanClient";

export const dynamic = "force-dynamic";

export const STAGES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "SITE_VISIT",
  "NEGOTIATION",
  "EOI",
  "BOOKING_DONE",
] as const;

export const STAGE_LABEL: Record<string, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  SITE_VISIT: "Site Visit",
  NEGOTIATION: "Negotiation",
  EOI: "EOI",
  BOOKING_DONE: "Booking Done",
};

export const STAGE_COLOR: Record<string, string> = {
  NEW: "bg-gray-100",
  CONTACTED: "bg-blue-50",
  QUALIFIED: "bg-indigo-50",
  SITE_VISIT: "bg-purple-50",
  NEGOTIATION: "bg-orange-50",
  EOI: "bg-amber-50",
  BOOKING_DONE: "bg-green-50",
};

export default async function KanbanPage() {
  const me = await requireUser();
  const scope = await leadScopeWhere(me);

  const leads = await prisma.lead.findMany({
    where: { ...scope, status: { notIn: ["LOST", "WON"] } },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      potential: true,
      followupDate: true,
      forwardedTeam: true,
      updatedAt: true,
      owner: { select: { name: true } },
    },
    orderBy: [{ potential: "asc" }, { createdAt: "desc" }],
    take: 500,
  });

  // Group leads by status and serialize dates to strings for client component
  const grouped: Record<string, Array<{
    id: string;
    name: string;
    phone: string | null;
    status: string;
    potential: string | null;
    followupDate: string | null;
    forwardedTeam: string | null;
    updatedAt: string;
    owner: { name: string } | null;
  }>> = {};

  for (const stage of STAGES) {
    grouped[stage] = [];
  }

  for (const lead of leads) {
    const stage = lead.status as string;
    if (!grouped[stage]) grouped[stage] = [];
    grouped[stage].push({
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      potential: lead.potential,
      followupDate: lead.followupDate ? lead.followupDate.toISOString().slice(0, 10) : null,
      forwardedTeam: lead.forwardedTeam,
      updatedAt: lead.updatedAt.toISOString(),
      owner: lead.owner,
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Pipeline Board</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {leads.length} active leads across {STAGES.length} stages
          </p>
        </div>
      </div>

      <KanbanClient
        grouped={grouped}
        stages={[...STAGES]}
        stageLabel={STAGE_LABEL}
        stageColor={STAGE_COLOR}
      />
    </>
  );
}

// Visual IF/THEN workflow builder page (spec §9.15).
//
// Lists every workflow as a card (name, trigger badge, action count, active
// toggle, last-run timestamp) and embeds the WorkflowBuilder client component
// which handles the inline editor + form state.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import WorkflowBuilderPanel, { type WorkflowSummary } from "@/components/WorkflowBuilder";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  await requireRole("ADMIN");

  // Pull workflows + their actions + the most recent WorkflowRun per workflow
  // (for the "last run" timestamp on each card).
  const [workflows, templates] = await Promise.all([
    prisma.workflow.findMany({
      include: {
        actions: { orderBy: { sequenceOrder: "asc" } },
        runs: { orderBy: { runAt: "desc" }, take: 1, select: { runAt: true } },
      },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    }),
    prisma.template.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, trigger: true },
    }),
  ]);

  const summaries: WorkflowSummary[] = workflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    description: wf.description,
    trigger: wf.trigger as WorkflowSummary["trigger"],
    triggerConfig: wf.triggerConfig,
    filterQuery: wf.filterQuery,
    active: wf.active,
    actionCount: wf.actions.length,
    lastRunAt: wf.runs[0]?.runAt ?? null,
    actions: wf.actions.map((a) => ({
      id: a.id,
      type: a.type as WorkflowSummary["actions"][number]["type"],
      delayMinutes: a.delayMinutes,
      config: a.config,
      sequenceOrder: a.sequenceOrder,
    })),
  }));

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Workflow Builder</h1>
          <p className="text-xs sm:text-sm text-gray-500 max-w-2xl">
            Build visual IF/THEN automations. WHEN something happens, IF the lead matches your conditions,
            THEN run a sequence of actions. Click any workflow card to edit it inline.
          </p>
        </div>
      </div>

      <WorkflowBuilderPanel
        workflows={summaries}
        templates={templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, trigger: t.trigger }))}
      />
    </>
  );
}

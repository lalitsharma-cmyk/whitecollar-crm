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

  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Pull workflows + their actions + the most recent WorkflowRun per workflow
  // (for the "last run" timestamp on each card).
  // Perf widget queries: counts + groupBy only — never findMany on WorkflowRun.
  const [
    workflows,
    templates,
    total24h,
    done24h,
    failed24h,
    skipped24h,
    runsByWorkflow24h,
    activeWorkflows,
    workflowsThatRan7d,
  ] = await Promise.all([
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
    prisma.workflowRun.count({ where: { createdAt: { gte: since24h } } }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since24h }, status: "DONE" } }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since24h }, status: "FAILED" } }),
    prisma.workflowRun.count({ where: { createdAt: { gte: since24h }, status: "SKIPPED" } }),
    prisma.workflowRun.groupBy({
      by: ["workflowId"],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.workflow.findMany({
      where: { active: true },
      select: { id: true, name: true },
    }),
    prisma.workflowRun.groupBy({
      by: ["workflowId"],
      where: { createdAt: { gte: since7d } },
    }),
  ]);

  // Hot loops: workflows with >=10 runs in last 24h.
  const wfNameById = new Map(workflows.map((w) => [w.id, w.name]));
  const hotLoops = runsByWorkflow24h
    .filter((r) => r._count._all >= 10)
    .map((r) => ({
      id: r.workflowId,
      name: wfNameById.get(r.workflowId) ?? r.workflowId,
      count: r._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  // Idle workflows: active=true but 0 runs in last 7d.
  const firedIds = new Set(workflowsThatRan7d.map((r) => r.workflowId));
  const idleWorkflows = activeWorkflows.filter((w) => !firedIds.has(w.id));

  const successRate = total24h > 0 ? Math.round((done24h / total24h) * 100) : null;
  const showWidget =
    total24h > 0 || hotLoops.length > 0 || idleWorkflows.length > 0;

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

      {showWidget && (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
          {/* Last 24h runs */}
          <div className="flex flex-col">
            <div className="text-xs uppercase tracking-wide text-gray-500">Last 24h runs</div>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{total24h}</div>
              {successRate !== null && (
                <div className="text-xs text-gray-600">
                  {successRate}% success
                </div>
              )}
            </div>
            <div className="text-[11px] text-gray-500">
              {done24h} done · {failed24h} failed · {skipped24h} skipped
            </div>
          </div>

          {/* Active workflows + hot loop warning */}
          <div className="flex flex-col">
            <div className="text-xs uppercase tracking-wide text-gray-500">Active workflows</div>
            <div className="text-2xl font-bold">{activeWorkflows.length}</div>
            {hotLoops.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-amber-700 hover:text-amber-900">
                  Auto-loop warning — {hotLoops.length} firing 10+ times / 24h
                </summary>
                <ul className="mt-1 ml-3 list-disc text-[11px] text-gray-700">
                  {hotLoops.map((w) => (
                    <li key={w.id}>
                      {w.name} — <span className="font-mono">{w.count}</span> runs
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <div className="text-[11px] text-gray-500">No over-firing detected</div>
            )}
          </div>

          {/* Idle workflows */}
          <div className="flex flex-col">
            <div className="text-xs uppercase tracking-wide text-gray-500">Idle workflows</div>
            <div className="text-2xl font-bold">{idleWorkflows.length}</div>
            {idleWorkflows.length > 0 ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-gray-600 hover:text-gray-900">
                  Potential dead rules — click to expand
                </summary>
                <ul className="mt-1 ml-3 list-disc text-[11px] text-gray-700">
                  {idleWorkflows.map((w) => (
                    <li key={w.id}>{w.name}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <div className="text-[11px] text-gray-500">All active rules firing</div>
            )}
          </div>
        </div>
      )}

      <WorkflowBuilderPanel
        workflows={summaries}
        templates={templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, trigger: t.trigger }))}
      />
    </>
  );
}

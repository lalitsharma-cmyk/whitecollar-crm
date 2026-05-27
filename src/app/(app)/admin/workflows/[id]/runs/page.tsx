// Admin → Workflow run history viewer.
//
// Shows every WorkflowRun row recorded for a given workflow so admins can
// see what fired, on which lead, and why anything failed. Filter chips at
// the top scope by status or date window via URL params.
//
// NOTE on schema field naming: per prisma/schema.prisma the WorkflowRun
// model exposes `startedAt`, `finishedAt`, `runAt`, `error`, and a status
// enum of PENDING / RUNNING / DONE / FAILED / SKIPPED. We treat DONE as
// "success" for the stats strip; FAILED as failures; everything else is
// neutral.
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RunFilter = "all" | "success" | "failed" | "7d" | "30d";

const FILTERS: { value: RunFilter; label: string }[] = [
  { value: "all",     label: "All" },
  { value: "success", label: "Success" },
  { value: "failed",  label: "Failed" },
  { value: "7d",      label: "Last 7d" },
  { value: "30d",     label: "Last 30d" },
];

function statusChip(status: string) {
  switch (status) {
    case "DONE":    return "chip-won";
    case "FAILED":  return "chip-hot";
    case "RUNNING": return "chip-warm";
    case "PENDING": return "chip-new";
    case "SKIPPED": return "chip-lost";
    default:        return "chip-lost";
  }
}

function shortJson(s: string | null | undefined, max = 80): string {
  if (!s) return "—";
  try {
    const obj = JSON.parse(s);
    const out = JSON.stringify(obj);
    return out.length > max ? out.slice(0, max) + "…" : out;
  } catch {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
}

function fmtDuration(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

export default async function WorkflowRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireRole("ADMIN");
  const { id } = await params;
  const sp = await searchParams;
  const filter: RunFilter =
    (["all", "success", "failed", "7d", "30d"] as const).includes(sp.filter as RunFilter)
      ? (sp.filter as RunFilter)
      : "all";

  const workflow = await prisma.workflow.findUnique({
    where: { id },
    include: { actions: true },
  });
  if (!workflow) notFound();

  // Build the run-query WHERE based on the chosen filter chip.
  const runWhere: Record<string, unknown> = { workflowId: id };
  const now = Date.now();
  if (filter === "success") runWhere.status = "DONE";
  else if (filter === "failed") runWhere.status = "FAILED";
  else if (filter === "7d")  runWhere.runAt = { gte: new Date(now - 7  * 24 * 3600 * 1000) };
  else if (filter === "30d") runWhere.runAt = { gte: new Date(now - 30 * 24 * 3600 * 1000) };

  // 30-day window for the stats strip is independent of the chip filter
  // so the "%" success number stays meaningful while you flip filters.
  const thirtyDaysAgo = new Date(now - 30 * 24 * 3600 * 1000);

  const [runs, total30d, success30d, failed30d] = await Promise.all([
    prisma.workflowRun.findMany({
      where: runWhere,
      orderBy: [{ startedAt: "desc" }, { runAt: "desc" }],
      take: 200,
    }),
    prisma.workflowRun.count({ where: { workflowId: id, runAt: { gte: thirtyDaysAgo } } }),
    prisma.workflowRun.count({ where: { workflowId: id, runAt: { gte: thirtyDaysAgo }, status: "DONE" } }),
    prisma.workflowRun.count({ where: { workflowId: id, runAt: { gte: thirtyDaysAgo }, status: "FAILED" } }),
  ]);

  // WorkflowRun has no relation to Lead in the schema — only a `leadId`
  // scalar — so we look up the leads in a second query and merge them in.
  const leadIds = Array.from(new Set(runs.map((r) => r.leadId)));
  const leadList = leadIds.length
    ? await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, name: true, phone: true },
      })
    : [];
  const leadMap = new Map(leadList.map((l) => [l.id, l]));

  const successRate = total30d > 0 ? Math.round((success30d / total30d) * 100) : 0;

  return (
    <>
      {/* Header card — workflow identity. Editing happens on /admin/workflows. */}
      <div className="card p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[11px] text-gray-500 mb-1">
              <Link href="/admin/workflows" className="hover:underline">← Back to workflows</Link>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold truncate">{workflow.name}</h1>
            {workflow.description && (
              <p className="text-xs sm:text-sm text-gray-500 mt-1">{workflow.description}</p>
            )}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              <span className="chip chip-new text-[10px]">trigger: {workflow.trigger}</span>
              <span className="chip chip-won text-[10px]">
                {workflow.actions.length} action{workflow.actions.length === 1 ? "" : "s"}
              </span>
              {workflow.filterQuery && (
                <span className="chip chip-warm text-[10px]">if: {workflow.filterQuery}</span>
              )}
              <span className={`chip text-[10px] ${workflow.active ? "chip-won" : "chip-lost"}`}>
                {workflow.active ? "ACTIVE" : "PAUSED"}
              </span>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Toggle active / edit actions on <Link href="/admin/workflows" className="underline">/admin/workflows</Link>.
            </p>
          </div>
        </div>
      </div>

      {/* Stats strip — last 30 days */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="card p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Runs (30d)</div>
          <div className="text-xl font-bold">{total30d}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Successful</div>
          <div className="text-xl font-bold text-emerald-600">{success30d}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Failed</div>
          <div className="text-xl font-bold text-red-600">{failed30d}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide">Success rate</div>
          <div className="text-xl font-bold">{successRate}%</div>
        </div>
      </div>

      {/* Filter chips */}
      <div className="card p-3 flex flex-wrap gap-2 items-center mb-3">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "all" ? `/admin/workflows/${id}/runs` : `/admin/workflows/${id}/runs?filter=${f.value}`}
            className={`chip text-[11px] ${filter === f.value ? "chip-warm" : "chip-lost"}`}
          >
            {f.label}
          </Link>
        ))}
        <span className="text-[11px] text-gray-500 ml-auto">
          Showing {runs.length} of latest 200
        </span>
      </div>

      {/* Runs table */}
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500">
          No runs match this filter yet.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Action / Config</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Duration</th>
                <th className="px-3 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const when = r.startedAt ?? r.runAt;
                const lead = leadMap.get(r.leadId);
                return (
                  <tr key={r.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{formatDistanceToNow(when, { addSuffix: true })}</div>
                      <div className="text-[10px] text-gray-400">{when.toLocaleString()}</div>
                    </td>
                    <td className="px-3 py-2">
                      {lead ? (
                        <Link href={`/leads/${lead.id}`} className="text-[#c9a24b] hover:underline">
                          {lead.name || lead.phone || r.leadId}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{r.leadId}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <div className="text-[11px] font-mono text-gray-600 dark:text-gray-300 break-all">
                        {shortJson(r.dedupeKey, 60)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip text-[10px] ${statusChip(r.status)}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell whitespace-nowrap text-gray-500">
                      {fmtDuration(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="px-3 py-2 text-red-600 max-w-xs">
                      {r.error ? (
                        <span title={r.error}>{r.error.slice(0, 100)}{r.error.length > 100 ? "…" : ""}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

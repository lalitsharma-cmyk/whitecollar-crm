import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import OperationsClient from "@/components/OperationsClient";

// ── Admin → Operations (Undo/Revert) — ADMIN / Super-Admin ONLY ──────────────
// Every structural op (Transfer / Edit-Field / Convert / Assignment, single + bulk)
// records an OperationLog with its before-state. This page lists the recent ones and
// lets an admin revert an accidental action, restoring the exact prior state.
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN") redirect("/dashboard");

  const ops = await prisma.operationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { createdBy: { select: { name: true } } },
  });

  const rows = ops.map((o) => ({
    id: o.id,
    operation: o.operation,
    module: o.module,
    field: o.field,
    summary: o.summary ?? o.operation,
    status: o.status,
    affectedCount: o.affectedCount,
    by: o.createdBy?.name ?? "—",
    createdAt: o.createdAt.toISOString(),
    undoneAt: o.undoneAt ? o.undoneAt.toISOString() : null,
  }));

  return (
    <>
      <div className="mb-3">
        <h1 className="text-xl sm:text-2xl font-bold">Operations — Undo / Revert</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Recent structural actions (transfer · edit field · convert · assignment). Revert restores the exact state
          before the action. Admin only.
        </p>
      </div>
      <OperationsClient rows={rows} />
    </>
  );
}

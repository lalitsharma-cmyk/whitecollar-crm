import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import ImportHistoryClient, { type ImportBatchRow } from "@/components/ImportHistoryClient";

export const dynamic = "force-dynamic";

export default async function ImportHistoryPage() {
  const me = await requireUser();
  // ADMIN-ONLY — managers and agents must never see import rollback controls.
  if (me.role !== "ADMIN") redirect("/leads");

  const batches = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      importedBy: { select: { name: true } },
      deletedBy: { select: { name: true } },
    },
    take: 200,
  });

  // Live (not soft-deleted) lead counts per batch — one grouped query.
  const liveGroups = batches.length
    ? await prisma.lead.groupBy({
        by: ["importBatchId"],
        where: { importBatchId: { in: batches.map((b) => b.id) }, deletedAt: null },
        _count: { _all: true },
      })
    : [];
  const liveByBatch = new Map(liveGroups.map((g) => [g.importBatchId, g._count._all]));

  const rows: ImportBatchRow[] = batches.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    importedBy: b.importedBy?.name ?? null,
    team: b.team,
    totalRows: b.totalRows,
    createdCount: b.createdCount,
    updatedCount: b.updatedCount,
    skippedCount: b.skippedCount,
    errorCount: b.errorCount,
    liveCount: liveByBatch.get(b.id) ?? 0,
    status: b.status,
    deletedAt: b.deletedAt ? b.deletedAt.toISOString() : null,
    deletedBy: b.deletedBy?.name ?? null,
    deleteReason: b.deleteReason,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/intake" className="hover:underline">Intake</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-slate-200 font-medium">Import History</span>
          </div>
          <h1 className="text-2xl font-bold mt-1">Import History</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-2xl">
            Every bulk CSV / Excel import. <b>Move to Trash</b> hides the leads an import created
            (with their activities, follow-ups, reminders and conversation history) — they are
            <b> not deleted</b>, just hidden, and can be <b>Restored</b> anytime. Only a
            <b> Super Admin</b> can permanently purge from the Trash. Admin only.
          </p>
        </div>
        <Link href="/intake" className="btn btn-ghost whitespace-nowrap">← Back to Intake</Link>
      </div>

      <ImportHistoryClient batches={rows} isSuperAdmin={me.isSuperAdmin} />
    </div>
  );
}

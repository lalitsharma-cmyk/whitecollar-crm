import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import BuyerImportHistoryClient, { type BuyerImportBatchRow } from "@/components/BuyerImportHistoryClient";

export const dynamic = "force-dynamic";

export default async function BuyerImportHistoryPage() {
  const me = await requireUser();
  // ADMIN-ONLY — managers and agents must never see import revert controls.
  if (me.role !== "ADMIN") redirect("/dashboard");

  const batches = await prisma.buyerImportBatch.findMany({
    orderBy: { importedAt: "desc" },
    take: 100,
    include: { importedBy: { select: { name: true } } },
  });

  // Live + trashed BuyerRecord counts per batch — two grouped queries.
  const ids = batches.map((b) => b.id);
  const [liveGroups, deletedGroups] = ids.length
    ? await Promise.all([
        prisma.buyerRecord.groupBy({
          by: ["importBatchId"],
          where: { importBatchId: { in: ids }, deletedAt: null },
          _count: { _all: true },
        }),
        prisma.buyerRecord.groupBy({
          by: ["importBatchId"],
          where: { importBatchId: { in: ids }, deletedAt: { not: null } },
          _count: { _all: true },
        }),
      ])
    : [[], []];
  const liveByBatch = new Map(liveGroups.map((g) => [g.importBatchId, g._count._all]));
  const deletedByBatch = new Map(deletedGroups.map((g) => [g.importBatchId, g._count._all]));

  // Resolve who soft-deleted each trashed batch (deletedById → user name).
  const deleterIds = Array.from(
    new Set(batches.map((b) => b.deletedById).filter((x): x is string => !!x)),
  );
  const deleters = deleterIds.length
    ? await prisma.user.findMany({ where: { id: { in: deleterIds } }, select: { id: true, name: true } })
    : [];
  const deleterName = new Map(deleters.map((u) => [u.id, u.name]));

  const rows: BuyerImportBatchRow[] = batches.map((b) => ({
    id: b.id,
    source: b.source,
    sourceRef: b.sourceRef,
    importedAt: b.importedAt.toISOString(),
    importedBy: b.importedBy?.name ?? null,
    recordCount: b.recordCount,
    successCount: b.successCount,
    errorCount: b.errorCount,
    liveCount: liveByBatch.get(b.id) ?? 0,
    deletedCount: deletedByBatch.get(b.id) ?? 0,
    status: b.status,
    deletedAt: b.deletedAt ? b.deletedAt.toISOString() : null,
    deletedBy: b.deletedById ? deleterName.get(b.deletedById) ?? null : null,
    deleteReason: b.deleteReason,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/buyer-data" className="hover:underline">Buyer Data</Link>
            <span>/</span>
            <span className="text-gray-700 dark:text-slate-200 font-medium">Import History</span>
          </div>
          <h1 className="text-2xl font-bold mt-1">Buyer Import History</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 max-w-2xl">
            Every Dubai / India Buyer Data import. <b>Move to Trash</b> hides the buyer records an
            import created — they are <b>not deleted</b>, just hidden from every list, pool, report
            and duplicate check, and can be <b>Restored</b> anytime. Only a <b>Super Admin</b> can
            permanently purge from the Trash. Admin only.
          </p>
        </div>
        <Link href="/buyer-data" className="btn btn-ghost whitespace-nowrap">← Back to Buyer Data</Link>
      </div>

      <BuyerImportHistoryClient batches={rows} isSuperAdmin={me.isSuperAdmin === true} />
    </div>
  );
}

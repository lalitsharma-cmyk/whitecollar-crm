import { requireHrPagePermission } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRImportClient from "@/components/HRImportClient";
import HRImportHistory from "@/components/HRImportHistory";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

export default async function HRImportPage() {
  const { me, role } = await requireHrPagePermission("importData");

  const [agents, history] = await Promise.all([
    getHrUsers(),
    prisma.hRImport.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { importedBy: { select: { name: true } } } }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Import Candidates</h1>
          <p className="text-sm text-gray-500">Bulk-import from Excel or CSV — map columns, handle duplicates, attach resume URLs.</p>
        </div>
        <Link href="/hr/candidates" className="text-sm text-blue-600 hover:underline">← Candidates</Link>
      </div>

      <HRImportClient agents={agents} defaultOwnerId={me.id} />

      {history.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-semibold text-gray-700 dark:text-slate-200">Import History <span className="text-[11px] font-normal text-gray-400">— times in IST</span></div>
          <HRImportHistory
            isAdmin={role === "ADMIN"}
            rows={history.map(h => ({
              id: h.id, fileName: h.fileName, by: h.importedBy?.name ?? null, createdAt: h.createdAt.toISOString(),
              total: h.total, imported: h.imported, updated: h.updated, skipped: h.skipped, failed: h.failed,
            }))}
          />
        </div>
      )}
    </div>
  );
}

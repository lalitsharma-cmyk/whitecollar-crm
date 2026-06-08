import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRImportClient from "@/components/HRImportClient";

export const dynamic = "force-dynamic";

export default async function HRImportPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") redirect("/hr");

  const [agents, history] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 text-sm font-semibold text-gray-700 dark:text-slate-200">Import History</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                {["Date", "File", "By", "Total", "New", "Updated", "Skipped", "Failed"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {history.map(h => (
                  <tr key={h.id}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{new Date(h.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2 text-xs max-w-[140px] truncate">{h.fileName}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{h.importedBy?.name?.split(" ")[0] ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-center">{h.total}</td>
                    <td className="px-3 py-2 text-xs text-center text-green-700 font-medium">{h.imported}</td>
                    <td className="px-3 py-2 text-xs text-center text-blue-700">{h.updated}</td>
                    <td className="px-3 py-2 text-xs text-center text-gray-500">{h.skipped}</td>
                    <td className="px-3 py-2 text-xs text-center text-red-600">{h.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

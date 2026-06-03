import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  await requireRole("ADMIN", "MANAGER");

  const logs = await prisma.auditLog.findMany({
    where: { action: "import.csv" },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { name: true } } },
  });

  return (
    <div className="space-y-4 max-w-5xl">
      <h1 className="text-xl font-bold">Import History</h1>
      <p className="text-sm text-gray-500">Last 100 CSV / Excel imports. Includes row counts, deduplications, and any errors.</p>

      {logs.length === 0 && (
        <div className="text-sm text-gray-400 p-8 text-center border rounded-xl">No imports recorded yet.</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="pb-2 pr-4">When</th>
              <th className="pb-2 pr-4">File</th>
              <th className="pb-2 pr-4">By</th>
              <th className="pb-2 pr-4">Team</th>
              <th className="pb-2 pr-4">Rows</th>
              <th className="pb-2 pr-4">Created</th>
              <th className="pb-2 pr-4">Deduped</th>
              <th className="pb-2">Errors</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              let m: Record<string, unknown> = {};
              try {
                if (log.meta) m = JSON.parse(log.meta) as Record<string, unknown>;
              } catch {
                // malformed meta — treat as empty
              }
              const hasErrors = Array.isArray(m.errors) && (m.errors as unknown[]).length > 0;
              return (
                <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{format(log.createdAt, "dd MMM HH:mm")}</td>
                  <td className="py-2 pr-4 font-medium max-w-[200px] truncate" title={String(m.fileName ?? "—")}>{String(m.fileName ?? "—")}</td>
                  <td className="py-2 pr-4 text-gray-600">{log.user?.name ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-600">{String(m.forceTeam ?? "—")}</td>
                  <td className="py-2 pr-4">{String(m.rowsProcessed ?? "—")}</td>
                  <td className="py-2 pr-4 text-emerald-700 font-semibold">{String(m.created ?? 0)}</td>
                  <td className="py-2 pr-4 text-amber-600">{String(m.deduped ?? 0)}</td>
                  <td className="py-2">
                    {hasErrors
                      ? <span className="text-red-600 font-medium">{(m.errors as unknown[]).length}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

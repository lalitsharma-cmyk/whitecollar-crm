"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatLeadName } from "@/lib/leadName";

export interface DeletedRow {
  id: string;
  name: string;
  phone: string | null;
  status: string | null;
  team: string | null;
  deletedAt: string;
  deletedBy: string;
}

export default function DeletedLeadsClient({ rows }: { rows: DeletedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/leads/${id}/restore`, { method: "POST" });
      if (r.ok) router.refresh();
    } finally { setBusy(null); }
  }

  if (rows.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
        No deleted leads. Anything you delete is kept here (with a full snapshot) and can be restored.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[760px]">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
            <th className="px-3 py-2.5">Lead</th>
            <th className="px-3 py-2.5">Phone</th>
            <th className="px-3 py-2.5">Status</th>
            <th className="px-3 py-2.5">Team</th>
            <th className="px-3 py-2.5">Deleted by</th>
            <th className="px-3 py-2.5">Deleted at (IST)</th>
            <th className="px-3 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/40">
              <td className="px-3 py-2.5 font-medium">{formatLeadName(r.name)}<div className="text-[10px] text-gray-400 font-mono">{r.id}</div></td>
              <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{r.phone ?? "—"}</td>
              <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300">{r.status ?? "—"}</td>
              <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300">{r.team ?? "—"}</td>
              <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{r.deletedBy}</td>
              <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300 whitespace-nowrap">{r.deletedAt}</td>
              <td className="px-3 py-2.5 text-right">
                <button type="button" disabled={busy === r.id} onClick={() => restore(r.id)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30 disabled:opacity-50">
                  {busy === r.id ? "Restoring…" : "↩ Restore"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

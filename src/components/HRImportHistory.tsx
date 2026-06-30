"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtISTShortLabelled } from "@/lib/datetime";

export interface ImportRow {
  id: string;
  fileName: string;
  by: string | null;
  createdAt: string;
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
}

export default function HRImportHistory({ rows, isAdmin }: { rows: ImportRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const confirmRow = rows.find(r => r.id === confirmId) ?? null;

  async function del() {
    if (!confirmRow) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/hr/imports/${confirmRow.id}`, { method: "DELETE" });
      if (r.ok) { setConfirmId(null); router.refresh(); return; }
      // Surface the server's reason (403 not-admin / 404 stale id) instead of
      // silently leaving the dialog open as if nothing happened.
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Could not delete this import batch. Please try again.");
    } catch {
      setErr("Network error — could not delete this import batch.");
    } finally { setBusy(false); }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
            {["When (IST)", "File", "By", "Total", "New", "Updated", "Skipped", "Failed", "Actions"].map(h => <th key={h} className="px-3 py-2 whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.map(h => (
              <tr key={h.id}>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtISTShortLabelled(h.createdAt)}</td>
                <td className="px-3 py-2 text-xs max-w-[140px] truncate" title={h.fileName}>{h.fileName}</td>
                <td className="px-3 py-2 text-xs text-gray-500">{h.by?.split(" ")[0] ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-center">{h.total}</td>
                <td className="px-3 py-2 text-xs text-center text-green-700 font-medium">{h.imported}</td>
                <td className="px-3 py-2 text-xs text-center text-blue-700">{h.updated}</td>
                <td className="px-3 py-2 text-xs text-center text-gray-500">{h.skipped}</td>
                <td className="px-3 py-2 text-xs text-center text-red-600">{h.failed}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <Link href={`/hr/candidates?batch=${h.id}`} className="text-blue-600 hover:underline">View</Link>
                    {h.failed > 0 && <a href={`/api/hr/imports/${h.id}`} className="text-gray-600 hover:underline" title="Download error report">Errors</a>}
                    {isAdmin && <button type="button" onClick={() => { setErr(null); setConfirmId(h.id); }} className="text-red-600 hover:underline">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && setConfirmId(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="font-semibold text-lg mb-1 text-red-700 dark:text-red-400">Delete this import batch?</div>
            <p className="text-sm text-gray-600 dark:text-slate-300">
              You are about to delete <b>{confirmRow.imported}</b> candidate{confirmRow.imported === 1 ? "" : "s"} and related workflow records
              created by <b className="break-all">{confirmRow.fileName}</b> — their follow-ups, interviews, timeline entries and resumes.
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-semibold">This cannot be undone.</p>
            {err && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 dark:bg-red-900/20 dark:border-red-700 dark:text-red-300">{err}</div>}
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => { setErr(null); setConfirmId(null); }} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button type="button" onClick={del} disabled={busy} className="btn bg-red-600 hover:bg-red-700 text-white border-red-600">{busy ? "Deleting…" : "Delete batch"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

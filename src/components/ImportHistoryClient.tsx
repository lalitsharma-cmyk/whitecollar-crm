"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export interface ImportBatchRow {
  id: string;
  fileName: string;
  createdAt: string;
  importedBy: string | null;
  team: string | null;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  liveCount: number;          // leads from this batch still live (not soft-deleted)
  status: string;             // ACTIVE | DELETED
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

export default function ImportHistoryClient({ batches }: { batches: ImportBatchRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ batch: ImportBatchRow; action: "delete" | "restore" } | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/intake/history/${confirm.batch.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirm.action, reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Action failed"); return; }
      setConfirm(null); setReason("");
      router.refresh();
    } catch {
      setErr("Network error — please retry.");
    } finally { setBusy(false); }
  }

  if (batches.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
        No bulk imports yet. CSV / Excel imports will appear here with rollback controls.
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[860px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="px-3 py-2.5">File</th>
              <th className="px-3 py-2.5 whitespace-nowrap">Imported</th>
              <th className="px-3 py-2.5">By</th>
              <th className="px-3 py-2.5">Team</th>
              <th className="px-2 py-2.5 text-right" title="Total rows in the file">Rows</th>
              <th className="px-2 py-2.5 text-right" title="New leads created">New</th>
              <th className="px-2 py-2.5 text-right" title="Existing leads updated (cannot be rolled back)">Upd</th>
              <th className="px-2 py-2.5 text-right" title="Rows skipped">Skip</th>
              <th className="px-2 py-2.5 text-right" title="Rows that errored">Err</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const isDeleted = b.status === "DELETED";
              const onlyUpdates = b.createdCount === 0;
              return (
                <tr
                  key={b.id}
                  className={`border-b border-gray-100 dark:border-slate-800 align-top ${isDeleted ? "bg-red-50/40 dark:bg-red-950/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}
                >
                  <td className="px-3 py-2.5 font-medium max-w-[220px]">
                    <span className="line-clamp-2" title={b.fileName}>{b.fileName}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{fmtDateTime(b.createdAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{b.importedBy ?? "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{b.team ?? "—"}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{b.totalRows}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">{b.createdCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-amber-700 dark:text-amber-400">{b.updatedCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-400">{b.skippedCount}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-400">{b.errorCount}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {isDeleted ? (
                      <span className="inline-flex flex-col gap-0.5">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 w-fit">Deleted</span>
                        <span className="text-[10px] text-gray-400">
                          by {b.deletedBy ?? "—"}{b.deletedAt ? ` · ${fmtDateTime(b.deletedAt)}` : ""}
                        </span>
                        {b.deleteReason && <span className="text-[10px] text-gray-400 italic max-w-[160px] line-clamp-2">“{b.deleteReason}”</span>}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</span>
                        <span className="text-[10px] text-gray-400">{b.liveCount} live</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {isDeleted ? (
                      <button
                        type="button"
                        onClick={() => { setErr(null); setReason(""); setConfirm({ batch: b, action: "restore" }); }}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                      >
                        ↩ Restore
                      </button>
                    ) : onlyUpdates ? (
                      <span
                        className="text-[11px] text-amber-700 dark:text-amber-400 italic max-w-[180px] inline-block"
                        title="This import only updated existing leads — there are no new leads to delete."
                      >
                        ⚠ Updates only — cannot roll back
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setErr(null); setReason(""); setConfirm({ batch: b, action: "delete" }); }}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        🗑 Delete import
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {confirm.action === "delete" ? (
              <>
                <div className="font-semibold text-lg mb-1">Delete this import?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  This will remove the <b>{confirm.batch.createdCount}</b> lead{confirm.batch.createdCount === 1 ? "" : "s"} created by{" "}
                  <b className="break-all">{confirm.batch.fileName}</b> — along with their activities, follow-ups, reminders and imported
                  conversation history — returning the CRM to its state before this import.
                </p>
                <ul className="text-xs text-gray-500 dark:text-slate-400 mt-2 space-y-1 list-disc pl-5">
                  <li>This is a <b>soft delete</b> — the data is hidden, not erased, and can be restored from this screen.</li>
                  {confirm.batch.updatedCount > 0 && (
                    <li className="text-amber-700 dark:text-amber-400">
                      {confirm.batch.updatedCount} existing lead{confirm.batch.updatedCount === 1 ? " was" : "s were"} only <b>updated</b> by this import and will <b>not</b> be reverted.
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <>
                <div className="font-semibold text-lg mb-1">Restore this import?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  This brings back the leads removed when <b className="break-all">{confirm.batch.fileName}</b> was deleted.
                </p>
              </>
            )}

            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300 block mt-4 mb-1">
              Reason {confirm.action === "delete" ? "(optional — kept in the audit log)" : "(optional)"}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={confirm.action === "delete" ? "e.g. wrong sheet / duplicate upload" : "e.g. deleted by mistake"}
              maxLength={500}
              className="w-full border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100"
            />

            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className={confirm.action === "delete"
                  ? "btn bg-red-600 hover:bg-red-700 text-white border-red-600"
                  : "btn btn-primary"}
              >
                {busy ? "Working…" : confirm.action === "delete" ? "Delete import" : "Restore import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
  liveCount: number;          // leads from this batch still live (not trashed)
  status: string;             // ACTIVE | DELETED (DELETED = in Trash)
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}

type ActionKind = "delete" | "restore" | "purge";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });
}

export default function ImportHistoryClient({ batches, isSuperAdmin = false }: { batches: ImportBatchRow[]; isSuperAdmin?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ batch: ImportBatchRow; action: ActionKind } | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const active = batches.filter((b) => b.status !== "DELETED");
  const trash = batches.filter((b) => b.status === "DELETED");

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

  const numCols = "px-2 py-2.5 text-right tabular-nums";

  function HeadRow({ trash: isTrash }: { trash: boolean }) {
    return (
      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
        <th className="px-3 py-2.5">File</th>
        <th className="px-3 py-2.5 whitespace-nowrap">Imported</th>
        <th className="px-3 py-2.5">By</th>
        <th className="px-3 py-2.5">Team</th>
        <th className="px-2 py-2.5 text-right" title="Total rows in the file">Rows</th>
        <th className="px-2 py-2.5 text-right" title="New leads created">New</th>
        <th className="px-2 py-2.5 text-right" title="Existing leads updated (cannot be rolled back)">Upd</th>
        {!isTrash && <th className="px-2 py-2.5 text-right" title="Rows skipped">Skip</th>}
        {!isTrash && <th className="px-2 py-2.5 text-right" title="Rows that errored">Err</th>}
        <th className="px-3 py-2.5">{isTrash ? "Trashed" : "Status"}</th>
        <th className="px-3 py-2.5 text-right">Action</th>
      </tr>
    );
  }

  function Cells({ b }: { b: ImportBatchRow }) {
    return (
      <>
        <td className="px-3 py-2.5 font-medium max-w-[220px]"><span className="line-clamp-2" title={b.fileName}>{b.fileName}</span></td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{fmtDateTime(b.createdAt)}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{b.importedBy ?? "—"}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{b.team ?? "—"}</td>
        <td className={numCols}>{b.totalRows}</td>
        <td className={`${numCols} font-semibold text-emerald-700 dark:text-emerald-400`}>{b.createdCount}</td>
        <td className={`${numCols} text-amber-700 dark:text-amber-400`}>{b.updatedCount}</td>
      </>
    );
  }

  return (
    <>
      {/* ── Active imports ─────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 text-sm font-semibold">Active imports</div>
        {active.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-slate-400">No active imports.</div>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[880px]">
            <thead><HeadRow trash={false} /></thead>
            <tbody>
              {active.map((b) => {
                const onlyUpdates = b.createdCount === 0;
                return (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800 align-top hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <Cells b={b} />
                    <td className={`${numCols} text-gray-400`}>{b.skippedCount}</td>
                    <td className={`${numCols} text-gray-400`}>{b.errorCount}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</span>
                        <span className="text-[10px] text-gray-400">{b.liveCount} live</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {onlyUpdates ? (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400 italic max-w-[180px] inline-block" title="This import only updated existing leads — there are no new leads to move to Trash.">
                          ⚠ Updates only — cannot roll back
                        </span>
                      ) : (
                        <button type="button" onClick={() => { setErr(null); setReason(""); setConfirm({ batch: b, action: "delete" }); }}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/30">
                          🗑 Move to Trash
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Import Trash ───────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="px-3 pt-3 flex items-center gap-2">
          <span className="text-sm font-semibold">🗑 Import Trash</span>
          <span className="text-[11px] text-gray-400">— hidden but safe. Restore anytime.{isSuperAdmin ? " Super Admin can purge permanently." : ""}</span>
        </div>
        {trash.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500 dark:text-slate-400">Trash is empty.</div>
        ) : (
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead><HeadRow trash={true} /></thead>
            <tbody>
              {trash.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800 align-top bg-red-50/40 dark:bg-red-950/10">
                  <Cells b={b} />
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex flex-col gap-0.5">
                      <span className="text-[10px] text-gray-500">{b.deletedBy ?? "—"}{b.deletedAt ? ` · ${fmtDateTime(b.deletedAt)}` : ""}</span>
                      {b.deleteReason && <span className="text-[10px] text-gray-400 italic max-w-[160px] line-clamp-2">“{b.deleteReason}”</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => { setErr(null); setReason(""); setConfirm({ batch: b, action: "restore" }); }}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30">
                        ↩ Restore
                      </button>
                      {isSuperAdmin && (
                        <button type="button" onClick={() => { setErr(null); setReason(""); setConfirm({ batch: b, action: "purge" }); }}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-400 text-red-700 hover:bg-red-50 dark:border-red-600 dark:text-red-300 dark:hover:bg-red-950/30">
                          ⚠ Purge forever
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !busy && setConfirm(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {confirm.action === "delete" && (
              <>
                <div className="font-semibold text-lg mb-1">Move this import to Trash?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  The <b>{confirm.batch.createdCount}</b> lead{confirm.batch.createdCount === 1 ? "" : "s"} created by{" "}
                  <b className="break-all">{confirm.batch.fileName}</b> will be hidden — along with their activities, follow-ups,
                  reminders and imported conversation history.
                </p>
                <ul className="text-xs text-gray-500 dark:text-slate-400 mt-2 space-y-1 list-disc pl-5">
                  <li><b>Nothing is deleted.</b> The leads move to Trash and can be <b>Restored</b> anytime.</li>
                  {confirm.batch.updatedCount > 0 && (
                    <li className="text-amber-700 dark:text-amber-400">{confirm.batch.updatedCount} existing lead{confirm.batch.updatedCount === 1 ? " was" : "s were"} only <b>updated</b> by this import and will <b>not</b> change.</li>
                  )}
                </ul>
              </>
            )}
            {confirm.action === "restore" && (
              <>
                <div className="font-semibold text-lg mb-1">Restore this import?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Brings back the leads from <b className="break-all">{confirm.batch.fileName}</b> exactly as they were.
                </p>
              </>
            )}
            {confirm.action === "purge" && (
              <>
                <div className="font-semibold text-lg mb-1 text-red-700 dark:text-red-400">⚠ Purge permanently?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  This <b>permanently deletes</b> the <b>{confirm.batch.createdCount}</b> lead{confirm.batch.createdCount === 1 ? "" : "s"} from{" "}
                  <b className="break-all">{confirm.batch.fileName}</b> and everything attached to them.
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-semibold">This cannot be undone. Only do this if you are sure.</p>
              </>
            )}

            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300 block mt-4 mb-1">
              Reason {confirm.action === "delete" ? "(optional — kept in the log)" : "(optional)"}
            </label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={confirm.action === "purge" ? "e.g. confirmed duplicate, safe to remove" : "e.g. wrong sheet / duplicate upload"}
              maxLength={500}
              className="w-full border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100" />

            {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setConfirm(null)} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button type="button" onClick={run} disabled={busy}
                className={confirm.action === "purge"
                  ? "btn bg-red-600 hover:bg-red-700 text-white border-red-600"
                  : confirm.action === "restore" ? "btn btn-primary" : "btn bg-amber-600 hover:bg-amber-700 text-white border-amber-600"}>
                {busy ? "Working…" : confirm.action === "delete" ? "Move to Trash" : confirm.action === "restore" ? "Restore" : "Purge forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

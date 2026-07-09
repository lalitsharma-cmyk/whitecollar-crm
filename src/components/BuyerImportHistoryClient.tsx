"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { backdropProps } from "@/lib/useDismiss";

export interface BuyerImportBatchRow {
  id: string;
  source: string;             // "Google Sheet", "Excel file", etc.
  sourceRef: string | null;   // URL or file name
  importedAt: string;
  importedBy: string | null;
  recordCount: number;        // rows in the import
  successCount: number;       // rows created/updated successfully
  errorCount: number;         // rows that failed
  liveCount: number;          // buyers from this batch still live (not trashed)
  deletedCount: number;       // buyers from this batch currently soft-deleted
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

export default function BuyerImportHistoryClient({ batches, isSuperAdmin = false }: { batches: BuyerImportBatchRow[]; isSuperAdmin?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ batch: BuyerImportBatchRow; action: ActionKind } | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const active = batches.filter((b) => b.status !== "DELETED");
  const trash = batches.filter((b) => b.status === "DELETED");

  // Records this action affects — live count for delete, trashed count for restore/purge.
  function affected(b: BuyerImportBatchRow, action: ActionKind): number {
    return action === "delete" ? b.liveCount : b.deletedCount;
  }

  async function run() {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/buyer-data/import/history/${confirm.batch.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirm.action, reason }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Action failed"); return; }
      setConfirm(null); setReason(""); setConfirmText("");
      router.refresh();
    } catch {
      setErr("Network error — please retry.");
    } finally { setBusy(false); }
  }

  const numCols = "px-2 py-2.5 text-right tabular-nums";
  const srcLabel = (b: BuyerImportBatchRow) => b.sourceRef?.trim() || b.source || "—";

  function HeadRow({ trash: isTrash }: { trash: boolean }) {
    return (
      <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
        <th className="px-3 py-2.5">Source / File</th>
        <th className="px-3 py-2.5 whitespace-nowrap">Imported</th>
        <th className="px-3 py-2.5">By</th>
        <th className="px-2 py-2.5 text-right" title="Rows in the import">Rows</th>
        <th className="px-2 py-2.5 text-right" title="Rows imported successfully">OK</th>
        {!isTrash && <th className="px-2 py-2.5 text-right" title="Rows that errored">Err</th>}
        <th className="px-3 py-2.5">{isTrash ? "Trashed" : "Status"}</th>
        <th className="px-3 py-2.5 text-right">Action</th>
      </tr>
    );
  }

  function Cells({ b }: { b: BuyerImportBatchRow }) {
    return (
      <>
        <td className="px-3 py-2.5 font-medium max-w-[260px]">
          <span className="line-clamp-2" title={srcLabel(b)}>{srcLabel(b)}</span>
          <span className="block text-[10px] text-gray-400 mt-0.5">{b.source}</span>
          <span className="block text-[10px] text-gray-400 font-mono mt-0.5" title="Import Batch ID — every imported buyer is traceable to this">{b.id}</span>
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{fmtDateTime(b.importedAt)}</td>
        <td className="px-3 py-2.5 whitespace-nowrap text-gray-600 dark:text-slate-300">{b.importedBy ?? "—"}</td>
        <td className={numCols}>{b.recordCount}</td>
        <td className={`${numCols} font-semibold text-emerald-700 dark:text-emerald-400`}>{b.successCount}</td>
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
          <table className="w-full text-sm border-collapse min-w-[760px]">
            <thead><HeadRow trash={false} /></thead>
            <tbody>
              {active.map((b) => {
                const nothingLive = b.liveCount === 0;
                return (
                  <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800 align-top hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <Cells b={b} />
                    <td className={`${numCols} text-gray-400`}>{b.errorCount}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</span>
                        <span className="text-[10px] text-gray-400">{b.liveCount} live</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {nothingLive ? (
                        <span className="text-[11px] text-amber-700 dark:text-amber-400 italic max-w-[180px] inline-block" title="No live buyers remain from this import — nothing to move to Trash.">
                          ⚠ No live records
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
          <table className="w-full text-sm border-collapse min-w-[760px]">
            <thead><HeadRow trash={true} /></thead>
            <tbody>
              {trash.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 dark:border-slate-800 align-top bg-red-50/40 dark:bg-red-950/10">
                  <Cells b={b} />
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex flex-col gap-0.5">
                      <span className="text-[10px] text-gray-500">{b.deletedBy ?? "—"}{b.deletedAt ? ` · ${fmtDateTime(b.deletedAt)}` : ""}</span>
                      <span className="text-[10px] text-gray-400">{b.deletedCount} in trash</span>
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
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" {...backdropProps(() => { if (!busy) { setConfirm(null); setConfirmText(""); } })}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {confirm.action === "delete" && (
              <>
                <div className="font-semibold text-lg mb-1">Move this import to Trash?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  This will remove <b>{affected(confirm.batch, "delete")}</b> record{affected(confirm.batch, "delete") === 1 ? "" : "s"} imported from{" "}
                  <b className="break-all">{srcLabel(confirm.batch)}</b>. Continue?
                </p>
                <ul className="text-xs text-gray-500 dark:text-slate-400 mt-2 space-y-1 list-disc pl-5">
                  <li><b>Nothing is deleted.</b> The buyers move to Trash and can be <b>Restored</b> anytime.</li>
                  <li>They disappear from every buyer list, pool, report and duplicate check while in Trash.</li>
                </ul>
              </>
            )}
            {confirm.action === "restore" && (
              <>
                <div className="font-semibold text-lg mb-1">Restore this import?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Brings back the <b>{affected(confirm.batch, "restore")}</b> buyer record{affected(confirm.batch, "restore") === 1 ? "" : "s"} from{" "}
                  <b className="break-all">{srcLabel(confirm.batch)}</b> exactly as they were.
                </p>
              </>
            )}
            {confirm.action === "purge" && (
              <>
                <div className="font-semibold text-lg mb-1 text-red-700 dark:text-red-400">⚠ Purge permanently?</div>
                <p className="text-sm text-gray-600 dark:text-slate-300">
                  Permanently delete <b>{affected(confirm.batch, "purge")}</b> record{affected(confirm.batch, "purge") === 1 ? "" : "s"} from{" "}
                  <b className="break-all">{srcLabel(confirm.batch)}</b>? This cannot be undone.
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-semibold">This cannot be undone. Only do this if you are sure.</p>
                <label className="text-xs font-semibold text-gray-600 dark:text-slate-300 block mt-3 mb-1">
                  Type <code className="px-1 py-0.5 rounded bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 font-mono">DELETE {affected(confirm.batch, "purge")} RECORDS</code> to confirm
                </label>
                <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off"
                  placeholder={`DELETE ${affected(confirm.batch, "purge")} RECORDS`}
                  className="w-full border border-red-300 dark:border-red-700 rounded-lg px-3 py-2 text-sm font-mono dark:bg-slate-800 dark:text-slate-100" />
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
              <button type="button" onClick={() => { setConfirm(null); setConfirmText(""); }} disabled={busy} className="btn btn-ghost">Cancel</button>
              <button type="button" onClick={run} disabled={busy || (confirm.action === "purge" && confirmText.trim() !== `DELETE ${affected(confirm.batch, "purge")} RECORDS`)}
                className={confirm.action === "purge"
                  ? "btn bg-red-600 hover:bg-red-700 text-white border-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
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

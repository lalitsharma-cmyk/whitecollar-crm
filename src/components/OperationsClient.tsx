"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Row {
  id: string;
  operation: string;
  module: string;
  field: string | null;
  summary: string;
  status: string;
  affectedCount: number;
  by: string;
  createdAt: string;
  undoneAt: string | null;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function fmtIst(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mo = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mo} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

const OP_LABEL: Record<string, string> = {
  "buyer.transfer": "Transfer",
  "buyer.edit": "Edit Field",
  "buyer.convert": "Convert to Lead",
  "lead.transfer": "Transfer",
  "lead.edit": "Edit Field",
  "lead.assign": "Assignment",
};
// Transfer/assignment = ownership change (blue) · Edit = metadata change (violet) ·
// Convert = structural move (amber) — same colour language as the action bar.
const OP_TINT: Record<string, string> = {
  "buyer.transfer": "bg-blue-100 text-blue-800",
  "lead.transfer": "bg-blue-100 text-blue-800",
  "lead.assign": "bg-blue-100 text-blue-800",
  "buyer.edit": "bg-violet-100 text-violet-800",
  "lead.edit": "bg-violet-100 text-violet-800",
  "buyer.convert": "bg-amber-100 text-amber-800",
};

export default function OperationsClient({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function revert(r: Row) {
    if (!window.confirm(
      `You are about to revert this operation and restore ${r.affectedCount} record${r.affectedCount === 1 ? "" : "s"} to its previous state. Continue?`,
    )) return;
    setBusy(r.id); setMsg(null);
    try {
      const res = await fetch(`/api/admin/operations/${r.id}/revert`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(`⚠ ${j.error ?? "Revert failed."}`); return; }
      setMsg(`✓ Reverted — restored ${j.restored} record${j.restored === 1 ? "" : "s"} to the previous state.`);
      router.refresh();
    } catch { setMsg("⚠ Network error during revert."); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
          {msg}
        </div>
      )}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400 text-sm">No operations logged yet.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date / Time (IST)</th>
                <th>Operation</th>
                <th>Module</th>
                <th>Change</th>
                <th>Records</th>
                <th>By</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-gray-500 dark:text-slate-400 font-mono">{fmtIst(r.createdAt)}</td>
                  <td><span className={`chip ${OP_TINT[r.operation] ?? "bg-gray-100 text-gray-700"}`}>{OP_LABEL[r.operation] ?? r.operation}</span></td>
                  <td className="text-sm">{r.module}</td>
                  <td className="text-sm text-gray-700 dark:text-slate-200">{r.summary}</td>
                  <td className="text-sm text-center font-semibold">{r.affectedCount}</td>
                  <td className="text-sm">{r.by}</td>
                  <td className="text-sm">
                    {r.status === "UNDONE"
                      ? <span className="text-gray-500 dark:text-slate-400">Reverted{r.undoneAt ? ` · ${fmtIst(r.undoneAt)}` : ""}</span>
                      : r.status === "EXECUTED"
                      ? <span className="text-emerald-700 dark:text-emerald-400">Applied</span>
                      : <span className="text-red-600">{r.status}</span>}
                  </td>
                  <td>
                    {r.status === "EXECUTED" ? (
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => revert(r)}
                        className="btn btn-ghost text-xs disabled:opacity-50"
                        title="Restore the exact state before this operation"
                      >
                        {busy === r.id ? "Reverting…" : "↩ Revert"}
                      </button>
                    ) : (
                      <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

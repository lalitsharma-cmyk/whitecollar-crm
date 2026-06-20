"use client";

import { useState } from "react";
import { Bot, Sparkles, ShieldCheck, AlertTriangle, Check, Undo2, Loader2, Play } from "lucide-react";

type PreviewLead = { id: string; name: string | null; phone: string | null; owner: string | null; team: string | null; status: string | null };
type PreviewResp = {
  ok: boolean; runId: string | null; intent: string; explanation: string; error: string | null;
  field: string | null; newValueLabel: string | null; count: number; sample: PreviewLead[];
  readOnly: boolean; agentCandidates: { id: string; name: string }[] | null;
};
type RunRow = { id: string; command: string; intent: string; status: string; affectedCount: number; newValue: string | null; createdAt: string };

const EXAMPLES = [
  "How many unassigned Dubai leads",
  "List India leads with no follow-up",
  "Assign all unassigned Dubai leads to Aleena",
  "Tag leads from Facebook as priority",
  "Move unassigned leads to India team",
  "Set follow-up for unassigned Dubai leads to tomorrow",
];

const FIELD_LABEL: Record<string, string> = { ownerId: "Owner", tags: "Tag", forwardedTeam: "Team", followupDate: "Follow-up date" };

export default function AdminAssistantClient({ recentRuns }: { recentRuns: RunRow[] }) {
  const [command, setCommand] = useState("");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "executing" | "done" | "undoing">("idle");
  const [runs, setRuns] = useState<RunRow[]>(recentRuns);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  async function doPreview(cmd?: string) {
    const c = (cmd ?? command).trim();
    if (!c) return;
    if (cmd) setCommand(cmd);
    setPhase("previewing"); setPreview(null); setToast(null);
    try {
      const r = await fetch("/api/admin/assistant/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command: c }) });
      const data: PreviewResp = await r.json();
      setPreview(data); setPhase("idle");
    } catch { setPhase("idle"); setToast({ kind: "err", msg: "Preview failed. Try again." }); }
  }

  async function doExecute() {
    if (!preview?.runId) return;
    setPhase("executing");
    try {
      const r = await fetch("/api/admin/assistant/execute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: preview.runId }) });
      const data = await r.json();
      if (!data.ok) { setToast({ kind: "err", msg: data.error ?? "Execution failed." }); setPhase("idle"); return; }
      setToast({ kind: "ok", msg: `Done — ${data.affected} lead${data.affected === 1 ? "" : "s"} updated. You can undo this below.` });
      setRuns((prev) => [{ id: preview.runId!, command, intent: preview.intent, status: "EXECUTED", affectedCount: data.affected, newValue: preview.newValueLabel, createdAt: new Date().toISOString() }, ...prev].slice(0, 12));
      setPreview(null); setCommand(""); setPhase("done");
    } catch { setToast({ kind: "err", msg: "Execution failed." }); setPhase("idle"); }
  }

  async function doUndo(runId: string) {
    setPhase("undoing");
    try {
      const r = await fetch("/api/admin/assistant/undo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId }) });
      const data = await r.json();
      if (!data.ok) { setToast({ kind: "err", msg: data.error ?? "Undo failed." }); setPhase("idle"); return; }
      setToast({ kind: "ok", msg: `Reverted — ${data.restored} lead${data.restored === 1 ? "" : "s"} restored.` });
      setRuns((prev) => prev.map((x) => (x.id === runId ? { ...x, status: "UNDONE" } : x)));
      setPhase("idle");
    } catch { setToast({ kind: "err", msg: "Undo failed." }); setPhase("idle"); }
  }

  const busy = phase === "previewing" || phase === "executing" || phase === "undoing";

  return (
    <div className="space-y-5">
      {/* Safety banner */}
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b>Safe by design.</b> Every command is previewed before anything changes — nothing runs silently.
          The assistant can only re-assign, tag, set team, or set follow-up, and every action is reversible.
          It can <b>never</b> delete leads, edit remarks, or touch conversation history. Deleted leads are always excluded.
        </div>
      </div>

      {/* Command box */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <Bot className="h-4 w-4 text-[#c9a24b]" /> What would you like to do?
        </label>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doPreview(); }}
          rows={2}
          placeholder='e.g. "Assign all unassigned Dubai leads to Aleena"'
          className="w-full resize-none rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#c9a24b] focus:ring-1 focus:ring-[#c9a24b] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => doPreview(ex)} disabled={busy}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600 hover:border-[#c9a24b] hover:text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {ex}
              </button>
            ))}
          </div>
          <button onClick={() => doPreview()} disabled={busy || !command.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-[#c9a24b] dark:text-slate-900">
            {phase === "previewing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Preview
          </button>
        </div>
      </div>

      {toast && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${toast.kind === "ok" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200"}`}>
          {toast.kind === "ok" ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />} {toast.msg}
        </div>
      )}

      {/* Preview result */}
      {preview && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {/* Unsupported / error */}
          {(!preview.ok && preview.readOnly) || preview.intent === "UNSUPPORTED" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-4 w-4" /> Can’t run that</div>
              <p className="text-[13px] text-slate-600 dark:text-slate-300">{preview.error || preview.explanation}</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">{preview.intent.replace("_", " ")}</span>
                <span className="text-sm text-slate-700 dark:text-slate-200">{preview.explanation}</span>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{preview.count} lead{preview.count === 1 ? "" : "s"} match</span>
                {!preview.readOnly && preview.field && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 text-[13px] text-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
                    Will set <b>{FIELD_LABEL[preview.field] ?? preview.field}</b> → <b>{preview.newValueLabel}</b>
                  </span>
                )}
              </div>

              {/* agent did-you-mean */}
              {preview.agentCandidates && preview.agentCandidates.length > 0 && (
                <div className="mb-3 text-[13px]">
                  <span className="text-slate-600 dark:text-slate-300">Did you mean: </span>
                  {preview.agentCandidates.map((c) => (
                    <button key={c.id} onClick={() => doPreview(command.replace(/to\s+\S+\s*$/i, `to ${c.name}`))}
                      className="mr-1.5 rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 hover:border-[#c9a24b] dark:border-slate-700 dark:text-slate-200">{c.name}</button>
                  ))}
                </div>
              )}

              {/* sample table */}
              {preview.sample.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-left text-[12px]">
                    <thead className="bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <tr><th className="px-3 py-1.5 font-medium">Name</th><th className="px-3 py-1.5 font-medium">Phone</th><th className="px-3 py-1.5 font-medium">Owner</th><th className="px-3 py-1.5 font-medium">Team</th><th className="px-3 py-1.5 font-medium">Status</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {preview.sample.map((l) => (
                        <tr key={l.id} className="text-slate-700 dark:text-slate-200">
                          <td className="px-3 py-1.5">{l.name || "—"}</td>
                          <td className="px-3 py-1.5">{l.phone || "—"}</td>
                          <td className="px-3 py-1.5">{l.owner || <span className="text-amber-600">unassigned</span>}</td>
                          <td className="px-3 py-1.5">{l.team || "—"}</td>
                          <td className="px-3 py-1.5">{l.status || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.count > preview.sample.length && <div className="bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">+ {preview.count - preview.sample.length} more</div>}
                </div>
              )}

              {/* approve / cancel */}
              {!preview.readOnly && preview.ok && preview.runId && (
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={doExecute} disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                    {phase === "executing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Approve & apply to {preview.count} lead{preview.count === 1 ? "" : "s"}
                  </button>
                  <button onClick={() => setPreview(null)} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">Cancel</button>
                </div>
              )}
              {!preview.ok && !preview.readOnly && preview.error && (
                <p className="mt-3 text-[13px] text-red-600 dark:text-red-300">{preview.error}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* Recent runs + undo */}
      {runs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Recent actions</h3>
          <div className="space-y-1.5">
            {runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-[13px] dark:border-slate-800">
                <div className="min-w-0">
                  <div className="truncate text-slate-700 dark:text-slate-200">{run.command}</div>
                  <div className="text-[11px] text-slate-400">{run.affectedCount} lead{run.affectedCount === 1 ? "" : "s"}{run.newValue ? ` → ${run.newValue}` : ""}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    run.status === "EXECUTED" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : run.status === "UNDONE" ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                    : run.status === "FAILED" ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"}`}>{run.status}</span>
                  {run.status === "EXECUTED" && (
                    <button onClick={() => doUndo(run.id)} disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">
                      <Undo2 className="h-3.5 w-3.5" /> Undo
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

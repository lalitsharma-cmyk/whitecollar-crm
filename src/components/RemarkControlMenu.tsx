"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { backdropProps } from "@/lib/useDismiss";

export interface RemarkControlState {
  deletedFromView: boolean;
  hiddenFromAll: boolean;
  hiddenFromUserIds: string | null;
  hiddenFromTeams: string | null;
}
interface LogRow {
  id: string;
  action: string;
  actorName: string | null;
  targetName: string | null;
  reason: string | null;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  DELETE: "Removed from view",
  RESTORE: "Restored",
  HIDE_ALL: "Hidden from everyone (except you)",
  UNHIDE_ALL: "Unhidden (everyone)",
  HIDE_AGENT: "Hidden from agent",
  UNHIDE_AGENT: "Unhidden for agent",
  HIDE_TEAM: "Hidden from team",
  UNHIDE_TEAM: "Unhidden for team",
};

/**
 * Lalit-only per-remark moderation menu. Renders a "⋯" button that opens a
 * dropdown of visibility actions for ONE imported remark, calls the
 * /remark-control API, and refreshes. Never edits the original remark text.
 */
export default function RemarkControlMenu({
  leadId, remarkKey, control, agents, teams = ["Dubai", "India"],
}: {
  leadId: string;
  remarkKey: string;
  control: RemarkControlState | null;
  agents: { id: string; name: string }[];
  teams?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentSub, setAgentSub] = useState(false);
  const [teamSub, setTeamSub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [logs, setLogs] = useState<LogRow[] | null>(null);

  const hiddenIds = new Set((control?.hiddenFromUserIds ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const hiddenTeams = new Set((control?.hiddenFromTeams ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const isDeleted = !!control?.deletedFromView;
  const isHiddenAll = !!control?.hiddenFromAll;

  function close() { setOpen(false); setAgentSub(false); setTeamSub(false); }

  async function act(action: string, target?: { userId?: string; team?: string }) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/remark-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarkKey, action, targetUserId: target?.userId, targetTeam: target?.team, reason: reason || undefined }),
      });
      if (r.ok) { close(); setReason(""); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function loadLogs() {
    setLogs([]);
    const r = await fetch(`/api/leads/${leadId}/remark-control?remarkKey=${encodeURIComponent(remarkKey)}`);
    if (r.ok) { const j = await r.json(); setLogs(j.logs ?? []); }
    close();
  }

  const item = "w-full text-left px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-slate-700 flex items-center gap-2 disabled:opacity-50";

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Conversation controls"
        className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 px-1 leading-none text-base"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋯
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-40" {...backdropProps(close)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl py-1 text-gray-700 dark:text-slate-100">
            {/* optional reason */}
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="w-[calc(100%-1rem)] mx-2 mb-1 px-2 py-1 text-[11px] border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700"
            />

            {isDeleted ? (
              <button type="button" disabled={busy} onClick={() => act("RESTORE")} className={item}>
                ↩ <span>Restore to view</span>
              </button>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => act("DELETE")} className={item}>
                  🙈 <span>Remove from view <span className="text-gray-400">(reversible)</span></span>
                </button>
                <button type="button" disabled={busy} onClick={() => act(isHiddenAll ? "UNHIDE_ALL" : "HIDE_ALL")} className={item}>
                  {isHiddenAll ? "👁 Show to everyone again" : "🔒 Hide from everyone (only you see)"}
                </button>
                <button type="button" disabled={busy} onClick={() => { setAgentSub((v) => !v); setTeamSub(false); }} className={item}>
                  👤 <span>Hide from agent…</span>
                  <span className="ml-auto text-gray-400">{agentSub ? "▾" : "▸"}</span>
                </button>
                {agentSub && (
                  <div className="max-h-40 overflow-y-auto border-y border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/40">
                    {agents.length === 0 && <div className="px-3 py-1.5 text-[11px] text-gray-400">No agents</div>}
                    {agents.map((a) => {
                      const hidden = hiddenIds.has(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          disabled={busy}
                          onClick={() => act(hidden ? "UNHIDE_AGENT" : "HIDE_AGENT", { userId: a.id })}
                          className={item}
                        >
                          <span className={`w-3.5 ${hidden ? "text-red-500" : "text-transparent"}`}>✓</span>
                          <span className="truncate">{a.name}</span>
                          {hidden && <span className="ml-auto text-[9px] text-red-500">hidden</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button type="button" disabled={busy} onClick={() => { setTeamSub((v) => !v); setAgentSub(false); }} className={item}>
                  👥 <span>Hide from team…</span>
                  <span className="ml-auto text-gray-400">{teamSub ? "▾" : "▸"}</span>
                </button>
                {teamSub && (
                  <div className="border-y border-gray-100 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/40">
                    {teams.map((t) => {
                      const hidden = hiddenTeams.has(t);
                      return (
                        <button
                          key={t}
                          type="button"
                          disabled={busy}
                          onClick={() => act(hidden ? "UNHIDE_TEAM" : "HIDE_TEAM", { team: t })}
                          className={item}
                        >
                          <span className={`w-3.5 ${hidden ? "text-red-500" : "text-transparent"}`}>✓</span>
                          <span className="truncate">{t} team</span>
                          {hidden && <span className="ml-auto text-[9px] text-red-500">hidden</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {(isHiddenAll || hiddenIds.size > 0 || hiddenTeams.size > 0) && (
                  <button type="button" disabled={busy} onClick={() => act("RESTORE")} className={item}>
                    ♻ <span>Clear all hiding</span>
                  </button>
                )}
              </>
            )}

            <div className="border-t border-gray-100 dark:border-slate-700 mt-1 pt-1">
              <button type="button" onClick={loadLogs} className={item}>📜 <span>View logs</span></button>
            </div>
          </div>
        </>
      )}

      {/* Logs modal */}
      {logs !== null && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4" onClick={() => setLogs(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-lg w-full p-5 shadow-2xl max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold">Remark audit log</div>
              <button type="button" onClick={() => setLogs(null)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
            </div>
            {logs.length === 0 ? (
              <div className="text-sm text-gray-500 py-4 text-center">No actions recorded for this remark yet.</div>
            ) : (
              <ul className="space-y-2">
                {logs.map((l) => (
                  <li key={l.id} className="text-xs border-l-2 border-gray-200 dark:border-slate-700 pl-3 py-1">
                    <div className="font-medium">
                      {ACTION_LABEL[l.action] ?? l.action}
                      {l.targetName ? ` · ${l.targetName}` : ""}
                    </div>
                    <div className="text-gray-500 dark:text-slate-400">
                      {l.actorName ?? "—"} · {new Date(l.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                    {l.reason && <div className="text-gray-400 italic mt-0.5">“{l.reason}”</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

"use client";
import { useState, useEffect } from "react";
import type { BuyerAgent } from "@/components/BuyerListClient";

// ── AI Buyer Distribution console (admin) ────────────────────────────────────
// Rule-based, preview → confirm (mirrors the safe /admin/assistant pattern — NO
// LLM). Three actions over the Admin Pool, plus a daily auto-distribute toggle:
//   • Assign N pool buyers to <agent>     (oldest-first)
//   • Split the pool equally across agents (round-robin)
//   • Send <region> buyers to <agent>      (region-filtered pool → agent)
// Every action shows a counts-per-agent PREVIEW before applying. Applying writes
// BuyerAssignment + BuyerActivity + notifies agents (the engine does this).

type PlanRow = { agentId: string; agentName: string; count: number; buyerIds: string[] };
type Plan = { rows: PlanRow[]; totalAssigned: number; poolAvailable: number; shortfall: number; note?: string };
type Mode = "assignN" | "splitEqually" | "byRegion";

export default function BuyerDistributionPanel({ agents, poolAvailable, onApplied }: { agents: BuyerAgent[]; poolAvailable: number; onApplied?: () => void }) {
  const [mode, setMode] = useState<Mode>("assignN");
  const [agentId, setAgentId] = useState("");
  const [n, setN] = useState("100");
  const [region, setRegion] = useState("");
  const [splitIds, setSplitIds] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | null>(null);
  const [phase, setPhase] = useState<"idle" | "previewing" | "applying">("idle");
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Daily auto-distribute toggle.
  const [autoOn, setAutoOn] = useState(false);
  const [autoTeam, setAutoTeam] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  useEffect(() => {
    fetch("/api/buyer-data/distribute").then((r) => r.json()).then((j) => {
      if (j?.autoDistribute) { setAutoOn(!!j.autoDistribute.enabled); setAutoTeam(j.autoDistribute.team ?? ""); }
    }).catch(() => {});
  }, []);

  const busy = phase !== "idle";
  const sel = "border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100";

  function body(): Record<string, unknown> {
    if (mode === "assignN") return { mode, agentId, n: Number(n) || 0, region: region || null };
    if (mode === "byRegion") return { mode, agentId, region: region || null };
    return { mode: "splitEqually", agentIds: Array.from(splitIds), region: region || null };
  }

  async function doPreview() {
    setToast(null); setPlan(null); setPhase("previewing");
    try {
      const r = await fetch("/api/buyer-data/distribute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: "preview", ...body() }) });
      const j = await r.json();
      if (!j.ok) { setToast({ ok: false, msg: j.error ?? "Could not build a plan." }); setPhase("idle"); return; }
      setPlan(j.plan); setPhase("idle");
    } catch { setToast({ ok: false, msg: "Preview failed." }); setPhase("idle"); }
  }

  async function doApply() {
    if (!plan || plan.totalAssigned === 0) return;
    setPhase("applying");
    try {
      const r = await fetch("/api/buyer-data/distribute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: "apply", ...body() }) });
      const j = await r.json();
      if (!j.ok) { setToast({ ok: false, msg: j.error ?? "Distribution failed." }); setPhase("idle"); return; }
      setToast({ ok: true, msg: `Done — ${j.totalAssigned} buyer${j.totalAssigned === 1 ? "" : "s"} distributed across ${j.perAgent.length} agent${j.perAgent.length === 1 ? "" : "s"}.` });
      setPlan(null); setPhase("idle");
      onApplied?.();
    } catch { setToast({ ok: false, msg: "Distribution failed." }); setPhase("idle"); }
  }

  async function toggleAuto(next: boolean) {
    setAutoBusy(true);
    try {
      const r = await fetch("/api/settings/buyer-distribute", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: next, team: autoTeam }) });
      if (r.ok) setAutoOn(next);
    } catch { /* ignore */ }
    finally { setAutoBusy(false); }
  }

  const toggleSplit = (id: string) => setSplitIds((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <div className="card p-4 space-y-4 border-l-4 border-[#c9a24b]">
      {/* Safety banner */}
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200">
        <span>🛡️</span>
        <div><b>Safe by design.</b> Every distribution is previewed (counts per agent) before anything moves. Only buyers in the <b>Admin Pool</b> are ever assigned — converted, assigned, and deleted buyers are never touched. Each assignment notifies the agent and is logged.</div>
      </div>

      <div className="font-semibold dark:text-slate-100">✨ Distribute Pool Buyers <span className="text-xs text-gray-400 font-normal">— {poolAvailable} in the Admin Pool</span></div>

      {/* Mode picker */}
      <div className="flex flex-wrap gap-1.5">
        {([["assignN", "Assign N to one agent"], ["splitEqually", "Split equally"], ["byRegion", "By region → agent"]] as [Mode, string][]).map(([m, label]) => (
          <button key={m} type="button" onClick={() => { setMode(m); setPlan(null); }} className={`px-3 py-1.5 rounded-lg text-sm ${mode === m ? "bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33]" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300"}`}>{label}</button>
        ))}
      </div>

      {/* Mode forms */}
      <div className="flex flex-wrap items-center gap-2">
        {(mode === "assignN" || mode === "byRegion") && (
          <select value={agentId} onChange={(e) => { setAgentId(e.target.value); setPlan(null); }} className={sel}>
            <option value="">Choose agent…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
          </select>
        )}
        {mode === "assignN" && (
          <input type="text" inputMode="numeric" value={n} onChange={(e) => { setN(e.target.value.replace(/[^\d]/g, "")); setPlan(null); }} placeholder="How many" className={`${sel} w-28`} />
        )}
        {(mode === "byRegion" || mode === "assignN" || mode === "splitEqually") && (
          <select value={region} onChange={(e) => { setRegion(e.target.value); setPlan(null); }} className={sel} title="Region filter">
            <option value="">{mode === "byRegion" ? "Region (required)" : "Any region"}</option>
            <option value="Dubai">Dubai / UAE</option>
            <option value="India">India</option>
          </select>
        )}
        {mode === "splitEqually" && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-gray-500">Across:</span>
            {agents.map((a) => (
              <button key={a.id} type="button" onClick={() => { toggleSplit(a.id); setPlan(null); }} className={`px-2 py-1 rounded-full text-xs border ${splitIds.has(a.id) ? "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-[#c9a24b] dark:text-[#0b1a33]" : "bg-white text-gray-600 border-gray-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600"}`}>{a.name}</button>
            ))}
          </div>
        )}
        <button type="button" onClick={doPreview} disabled={busy} className="btn btn-ghost text-sm disabled:opacity-40">{phase === "previewing" ? "Previewing…" : "🔍 Preview"}</button>
      </div>

      {toast && <div className={`text-sm px-3 py-2 rounded ${toast.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200" : "bg-red-50 text-red-800 dark:bg-red-900/30 dark:text-red-200"}`}>{toast.ok ? "✓ " : "⚠ "}{toast.msg}</div>}

      {/* Preview */}
      {plan && (
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-2">
          <div className="text-sm text-gray-700 dark:text-slate-200">{plan.note}</div>
          {plan.shortfall > 0 && <div className="text-xs text-amber-600">⚠ Only {plan.poolAvailable} buyer{plan.poolAvailable === 1 ? "" : "s"} in the matching pool — {plan.shortfall} short of the request.</div>}
          {plan.rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-800"><th className="py-1">Agent</th><th className="py-1 text-right">Buyers</th></tr></thead>
              <tbody>
                {plan.rows.map((r) => (<tr key={r.agentId} className="border-b border-gray-50 dark:border-slate-800/50"><td className="py-1">{r.agentName}</td><td className="py-1 text-right tabular-nums font-medium">{r.count}</td></tr>))}
                <tr className="font-semibold"><td className="py-1">Total</td><td className="py-1 text-right tabular-nums">{plan.totalAssigned}</td></tr>
              </tbody>
            </table>
          ) : <div className="text-sm text-gray-500">No buyers to assign with these settings.</div>}
          {plan.totalAssigned > 0 && (
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={doApply} disabled={busy} className="btn btn-primary text-sm disabled:opacity-40">{phase === "applying" ? "Applying…" : `✓ Approve & assign ${plan.totalAssigned}`}</button>
              <button type="button" onClick={() => setPlan(null)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Daily auto-distribute toggle */}
      <div className="border-t border-gray-100 dark:border-slate-800 pt-3 flex items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium text-gray-700 dark:text-slate-200">Daily auto-distribution</div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">When on, the Admin Pool is round-robined across the active team every day. Off by default.</div>
        </div>
        <button type="button" onClick={() => toggleAuto(!autoOn)} disabled={autoBusy}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${autoOn ? "bg-emerald-500" : "bg-gray-300 dark:bg-slate-600"}`}
          aria-pressed={autoOn} aria-label="Toggle daily auto-distribution">
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${autoOn ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>
    </div>
  );
}

"use client";
// AI Sales OS console (client). Surfaces every layer of the Read-Only-First pipeline and
// the approval → apply flow. All reads are gated behind ai.enabled; the only write is the
// reversible, whitelisted, audited /api/ai/apply. Deterministic by default.
import { useCallback, useState } from "react";

type EngineStatus = { provider: string; ready: boolean; model: string | null; reason: string };
type Suggestion = {
  id: string; action: string; rationale: string; confidence: string;
  mutation: { entity: string; entityId: string; field: string; from: unknown; to: unknown } | null;
};
type AnalyzeResult = { explanation: string; engine: string; detections: { title: string; kind: string; confidence: string }[]; suggestions: Suggestion[] };
type Match = { buyerId: string; name: string | null; score: number; confidence: string; reasons: { key: string; detail: string }[] };
type Digest = { summary: Record<string, number> & { byMarket?: Record<string, number> }; nudges: { ownerName: string; headline: string; priority: string }[]; topRisks: string[] };

const CARD = "card p-4 space-y-3";
const badge = (c: string) => c === "high" ? "bg-emerald-100 text-emerald-700" : c === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";

export default function AiConsoleClient({ enabled: initialEnabled, status }: { enabled: boolean; status: EngineStatus }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const toggleAi = useCallback(async () => {
    setBusy("toggle"); setErr(null);
    try {
      const r = await fetch("/api/settings/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      setEnabled(!enabled);
    } catch (e) { setErr(String(e)); } finally { setBusy(null); }
  }, [enabled]);

  return (
    <div className="space-y-4">
      {/* Engine + master switch */}
      <div className={CARD}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">Engine: <span className="font-mono">{status.provider}{status.model ? ` · ${status.model}` : ""}</span></div>
            <div className={`text-xs ${status.ready ? "text-emerald-600" : "text-amber-600"}`}>{status.reason}</div>
          </div>
          <button onClick={toggleAi} disabled={busy === "toggle"} className={`btn ${enabled ? "btn-ghost" : "btn-primary"}`}>
            {busy === "toggle" ? "…" : enabled ? "AI is ON — turn off" : "Turn AI ON (mock)"}
          </button>
        </div>
        {!status.ready && (
          <div className="text-xs text-gray-500 dark:text-slate-400">
            Running on the deterministic engine. To enable live reasoning, set the provider key in Vercel env
            (e.g. <span className="font-mono">AI_GEMINI_API_KEY</span>) — no code change needed.
          </div>
        )}
        {err && <div className="text-xs text-red-600">{err}</div>}
      </div>

      {!enabled ? (
        <div className={CARD}><div className="text-sm text-gray-500 dark:text-slate-400">AI is off. Turn it on above to run analysis, self-heal, matching and the digest (all on the free deterministic engine until a key is added).</div></div>
      ) : (
        <>
          <SelfHealPanel setErr={setErr} />
          <AnalyzePanel />
          <MatchPanel />
          <DigestPanel />
        </>
      )}
    </div>
  );

  // ── Data-quality self-heal — the approval → apply flow ─────────────────────
  function SelfHealPanel({ setErr }: { setErr: (s: string | null) => void }) {
    const [items, setItems] = useState<Suggestion[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [applied, setApplied] = useState<Record<string, boolean>>({});
    const load = async () => {
      setLoading(true); setErr(null);
      try {
        const r = await fetch("/api/ai/data-quality");
        const j = await r.json();
        setItems(r.ok ? (j.suggestions ?? []) : []);
        if (!r.ok) setErr(j.error || "Failed");
      } catch (e) { setErr(String(e)); } finally { setLoading(false); }
    };
    const apply = async (s: Suggestion) => {
      if (!s.mutation) return;
      setBusy(s.id); setErr(null);
      try {
        const r = await fetch("/api/ai/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutation: s.mutation }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Apply failed");
        setApplied((a) => ({ ...a, [s.id]: true }));
      } catch (e) { setErr(String(e)); } finally { setBusy(null); }
    };
    return (
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">🩺 Data-Quality Self-Heal</div>
          <button onClick={load} disabled={loading} className="btn btn-ghost text-xs">{loading ? "Scanning…" : "Scan"}</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-slate-400">Reversible fixes the AI proposes (e.g. set a derivable missing market). Nothing changes until you Apply — each apply is audited and reversible.</p>
        {items && items.length === 0 && <div className="text-xs text-emerald-600">No fixes needed — data is clean. ✓</div>}
        {items && items.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 border-t border-gray-100 dark:border-slate-800 pt-2">
            <div className="min-w-0">
              <div className="text-sm">{s.rationale}</div>
              <div className="text-[11px] text-gray-400 font-mono truncate">{s.mutation ? `${s.mutation.entity}.${s.mutation.field}: ${JSON.stringify(s.mutation.from)} → ${JSON.stringify(s.mutation.to)}` : ""}</div>
            </div>
            {applied[s.id] ? <span className="text-xs text-emerald-600 whitespace-nowrap">Applied ✓</span>
              : <button onClick={() => apply(s)} disabled={busy === s.id} className="btn btn-primary text-xs whitespace-nowrap">{busy === s.id ? "…" : "Approve & Apply"}</button>}
          </div>
        ))}
      </div>
    );
  }

  // ── Lead intelligence (analyze → detect → suggest) ─────────────────────────
  function AnalyzePanel() {
    const [id, setId] = useState(""); const [res, setRes] = useState<AnalyzeResult | null>(null); const [loading, setLoading] = useState(false); const [e, setE] = useState<string | null>(null);
    const run = async () => {
      if (!id.trim()) return; setLoading(true); setE(null); setRes(null);
      try { const r = await fetch(`/api/ai/analyze?kind=lead&id=${encodeURIComponent(id.trim())}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setRes(j.result ?? j); } catch (x) { setE(String(x)); } finally { setLoading(false); }
    };
    return (
      <div className={CARD}>
        <div className="font-semibold">🔎 Lead Intelligence</div>
        <div className="flex gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Lead ID" className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1 text-sm flex-1" />
          <button onClick={run} disabled={loading} className="btn btn-primary text-xs">{loading ? "…" : "Analyze"}</button>
        </div>
        {e && <div className="text-xs text-red-600">{e}</div>}
        {res && (
          <div className="space-y-2">
            <div className="text-sm">{res.explanation} <span className="text-[10px] text-gray-400">({res.engine})</span></div>
            {res.detections?.map((d, i) => <div key={i} className="text-xs"><span className={`px-1.5 py-0.5 rounded ${badge(d.confidence)}`}>{d.kind}</span> {d.title}</div>)}
            {res.suggestions?.map((s) => <div key={s.id} className="text-xs text-gray-600 dark:text-slate-300">→ {s.rationale}</div>)}
          </div>
        )}
      </div>
    );
  }

  // ── Buyer ↔ seller matching ────────────────────────────────────────────────
  function MatchPanel() {
    const [id, setId] = useState(""); const [res, setRes] = useState<Match[] | null>(null); const [loading, setLoading] = useState(false); const [e, setE] = useState<string | null>(null);
    const run = async () => {
      if (!id.trim()) return; setLoading(true); setE(null); setRes(null);
      try { const r = await fetch(`/api/ai/matches?propertyLeadId=${encodeURIComponent(id.trim())}`); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setRes(j.matches ?? []); } catch (x) { setE(String(x)); } finally { setLoading(false); }
    };
    return (
      <div className={CARD}>
        <div className="font-semibold">🤝 Buyer ↔ Seller Matching</div>
        <div className="flex gap-2">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Seller / property Lead ID" className="border border-gray-300 dark:border-slate-600 dark:bg-slate-800 rounded px-2 py-1 text-sm flex-1" />
          <button onClick={run} disabled={loading} className="btn btn-primary text-xs">{loading ? "…" : "Match"}</button>
        </div>
        {e && <div className="text-xs text-red-600">{e}</div>}
        {res && res.length === 0 && <div className="text-xs text-gray-500">No same-market buyer matches.</div>}
        {res?.map((m) => (
          <div key={m.buyerId} className="text-xs border-t border-gray-100 dark:border-slate-800 pt-1">
            <span className={`px-1.5 py-0.5 rounded ${badge(m.confidence)}`}>{m.confidence}</span> {m.name ?? m.buyerId} · score {m.score}
            <div className="text-[11px] text-gray-400">{m.reasons?.map((r) => r.detail).join(" · ")}</div>
          </div>
        ))}
      </div>
    );
  }

  // ── Team BI digest ─────────────────────────────────────────────────────────
  function DigestPanel() {
    const [res, setRes] = useState<Digest | null>(null); const [loading, setLoading] = useState(false); const [e, setE] = useState<string | null>(null);
    const run = async () => {
      setLoading(true); setE(null);
      try { const r = await fetch("/api/ai/digest"); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Failed"); setRes(j); } catch (x) { setE(String(x)); } finally { setLoading(false); }
    };
    return (
      <div className={CARD}>
        <div className="flex items-center justify-between"><div className="font-semibold">📊 Team Digest</div><button onClick={run} disabled={loading} className="btn btn-ghost text-xs">{loading ? "…" : "Refresh"}</button></div>
        {e && <div className="text-xs text-red-600">{e}</div>}
        {res && (
          <div className="space-y-1 text-xs">
            <div>Workable {res.summary.workable} · Fresh {res.summary.freshToday} · Overdue {res.summary.overdueFollowups} · Hot-uncontacted {res.summary.hotUncontacted} · Stalled {res.summary.stalled}</div>
            {res.topRisks?.map((r, i) => <div key={i} className="text-amber-600">⚠ {r}</div>)}
            {res.nudges?.slice(0, 6).map((n, i) => <div key={i}><span className={`px-1.5 py-0.5 rounded ${badge(n.priority)}`}>{n.priority}</span> {n.ownerName}: {n.headline}</div>)}
          </div>
        )}
      </div>
    );
  }
}

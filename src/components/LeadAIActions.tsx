"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Wand2, X, CheckCircle2 } from "lucide-react";

interface Props {
  leadId: string;
  /** True when this lead has any remarks worth parsing — hides buttons otherwise. */
  hasRemarks: boolean;
}

/**
 * Two manual AI actions on the lead detail page:
 *  • 🪄 Auto-fill from remarks — runs the regex extractor + shows a preview modal
 *    of what fields would change, so the agent can confirm before applying.
 *    Free (no API call).
 *  • 🧠 Deep AI analysis — calls Anthropic with the FULL lead context
 *    (remarks + call logs + activities + qualification fields) and overwrites
 *    aiSummary + aiScore. Costs ~$0.01-0.05 per click.
 */
export default function LeadAIActions({ leadId, hasRemarks }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"autofill" | "deep" | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function previewAutofill() {
    if (busy) return;
    setBusy("autofill"); setMsg(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: false }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error ?? "Failed" }); return; }
      if (!j.toApply || Object.keys(j.toApply).length === 0) {
        setMsg({ kind: "ok", text: "Nothing to auto-fill — every detected field is already set. Edit remarks and try again." });
        return;
      }
      setPreview(j.toApply);
    } catch (e) {
      setMsg({ kind: "err", text: `Network error: ${String(e).slice(0, 80)}` });
    } finally { setBusy(null); }
  }

  async function applyAutofill() {
    if (busy) return;
    setBusy("autofill");
    try {
      const r = await fetch(`/api/leads/${leadId}/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error ?? "Failed" }); return; }
      setPreview(null);
      setMsg({ kind: "ok", text: `Filled ${j.applied} field${j.applied === 1 ? "" : "s"} from remarks.` });
      router.refresh();
    } finally { setBusy(null); }
  }

  async function deepAnalyze() {
    if (busy) return;
    if (!confirm("Run a deep AI analysis on this lead? This calls Anthropic (~₹2-4 per click) and overwrites the AI summary + score.")) return;
    setBusy("deep"); setMsg(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/deep-analyze`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) { setMsg({ kind: "err", text: j.error ?? "Failed" }); return; }
      setMsg({ kind: "ok", text: `Re-analyzed: ${j.bucket} · ${j.score}/100. AI Summary card refreshed.` });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: `Network error: ${String(e).slice(0, 80)}` });
    } finally { setBusy(null); }
  }

  if (!hasRemarks) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2 mt-2">
        <button
          onClick={previewAutofill}
          disabled={!!busy}
          className="btn btn-ghost text-xs flex items-center gap-1.5 min-h-10"
          title="Scan the remarks and pre-fill empty fields (budget, city, profession, etc.)"
        >
          <Wand2 className="w-3.5 h-3.5" /> {busy === "autofill" ? "Scanning…" : "🪄 Auto-fill from remarks"}
        </button>
        <button
          onClick={deepAnalyze}
          disabled={!!busy}
          className="btn btn-ghost text-xs flex items-center gap-1.5 min-h-10 bg-amber-50 border-amber-300"
          title="Run a full Anthropic analysis on the lead's remarks + call history + activities"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-600" /> {busy === "deep" ? "Analyzing…" : "🧠 Deep AI analysis"}
        </button>
      </div>
      {msg && (
        <div className={`mt-2 text-xs p-2 rounded-lg ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {msg.text}
        </div>
      )}

      {/* Preview modal — confirm before writing */}
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => !busy && setPreview(null)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg flex items-center gap-2"><Wand2 className="w-5 h-5 text-[#c9a24b]" /> Auto-fill preview</div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Detected from remarks. Existing values won't be overwritten — only empty fields fill.
            </p>
            <div className="space-y-1.5 text-sm border rounded-lg p-3 bg-gray-50 max-h-64 overflow-y-auto">
              {Object.entries(preview).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <span className="text-xs text-gray-500">{k}</span>
                  <span className="font-mono text-xs text-[#0b1a33] truncate">{String(v)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setPreview(null)} disabled={!!busy} className="btn btn-ghost flex-1 justify-center">Cancel</button>
              <button onClick={applyAutofill} disabled={!!busy} className="btn btn-primary flex-1 justify-center">
                {busy === "autofill" ? "Applying…" : <><CheckCircle2 className="w-4 h-4" /> Apply</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

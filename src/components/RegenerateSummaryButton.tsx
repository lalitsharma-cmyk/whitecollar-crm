"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/**
 * Manual "Regenerate AI Summary" button. Hits the synchronous
 * /api/leads/[id]/regenerate-summary endpoint so we know whether the AI call
 * actually succeeded — vs the fire-and-forget on log-call that can silently
 * fail when the serverless function tears down before the background promise
 * completes.
 *
 * Surfaces specific error reasons inline (wrong key, no quota, etc.) instead
 * of the agent staring at a stale summary wondering why nothing changed.
 */
export default function RegenerateSummaryButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean>(true);

  async function go() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/regenerate-summary`, {
        method: "POST",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setOk(false);
        setMsg(j.reason ?? `Failed (HTTP ${r.status})`);
        return;
      }
      setOk(true);
      setMsg(`✓ Updated via ${j.provider} (${j.latencyMs}ms)`);
      router.refresh();
    } catch (e) {
      setOk(false);
      setMsg(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={go}
        disabled={busy}
        title="Re-ask the AI to summarise this lead based on the latest call history"
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white border border-[#c9a24b] text-[#0b1a33] font-semibold hover:bg-amber-50 disabled:opacity-50 min-h-8"
      >
        <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
        {busy ? "Asking AI…" : "Regenerate"}
      </button>
      {msg && (
        <span className={`text-[10px] ${ok ? "text-emerald-700" : "text-red-700"} max-w-[280px] text-right`}>
          {msg}
        </span>
      )}
    </div>
  );
}

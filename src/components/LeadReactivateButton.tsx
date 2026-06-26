"use client";
// Reactivate a rejected lead — POSTs the reactivate route (admin/manager only,
// re-checked server-side), which resets the lead to a workable "Fresh Lead" and
// clears the rejection stamp so it returns to the working board + can be reassigned.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LeadReactivateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reactivate() {
    if (busy) return;
    if (!window.confirm("Reactivate this rejected lead? It returns to the working board as a Fresh Lead and can then be reassigned.")) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/reactivate`, { method: "POST" });
      if (r.ok) { router.refresh(); return; }
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "Couldn't reactivate this lead.");
    } catch { setErr("Network error — couldn't reactivate."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <button type="button" onClick={reactivate} disabled={busy}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
        {busy ? "Reactivating…" : "♻️ Reactivate Lead"}
      </button>
      {err && <div className="text-[10px] text-red-600 dark:text-red-400 mt-1">{err}</div>}
    </div>
  );
}

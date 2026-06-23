"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Buyer Quick Note ─────────────────────────────────────────────────────────
// Mirrors the Lead view's QuickNoteCard EXACTLY (same card, same heading style,
// same navy Save button) but writes a buyer NOTE activity via the buyer activity
// endpoint so it lands in the buyer's Smart Timeline. Only enabled when the buyer
// is ASSIGNED and the viewer can log (assigned agent / admin); otherwise the
// textarea is replaced with a short hint so the card still renders at parity but
// can't post into a pool/converted buyer.
export default function BuyerQuickNoteCard({ buyerId, canLog }: { buyerId: string; canLog: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/buyer-data/${buyerId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "NOTE", description: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save note"); return; }
      setText("");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-sm">📝 Quick Note</div>
      </div>
      {canLog ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note about this buyer…"
            maxLength={2000}
            disabled={saving}
            className="w-full rounded border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#0b1a33] dark:text-slate-200 disabled:opacity-60"
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !text.trim()}
              className="px-4 py-1.5 rounded bg-[#0b1a33] text-white text-sm font-medium hover:bg-[#1a2f55] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving…" : "Save Note"}
            </button>
            {saved && <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      ) : (
        <div className="text-sm text-gray-500 dark:text-slate-400">
          Notes can be added once this buyer is assigned to an agent.
        </div>
      )}
    </div>
  );
}

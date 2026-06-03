"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  leadId: string;
}

export default function QuickNoteCard({ leadId }: Props) {
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
      const res = await fetch(`/api/leads/${leadId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to save note");
        return;
      }

      setText("");
      setSaved(true);
      router.refresh();

      // Clear "Saved ✓" confirmation after 2.5 s
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Network error — please try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="font-semibold text-sm mb-3">📝 Quick Note</div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note about this lead…"
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
          {saved && (
            <span className="text-sm text-emerald-600 font-medium">Saved ✓</span>
          )}
          {error && (
            <span className="text-sm text-red-600">{error}</span>
          )}
        </div>
      </form>
    </div>
  );
}

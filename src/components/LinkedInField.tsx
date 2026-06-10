"use client";

// LinkedIn field for the lead detail page. Replaces the old "link + InlineEdit
// with display='✏ edit'" combo that rendered as broken junk ("|| --edit").
//
// Behaviour (Lalit's spec):
//   • Empty            → shows only "Add Value" (click to add).
//   • Saved URL        → shows ONLY the clickable linkedin.com/in/… link, plus a
//                        small pencil to edit. Nothing else.
//   • Saving persists and the value stays under the field after refresh.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

function toHref(v: string): string {
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

// Short display label: strip protocol + linkedin host so the cell shows
// "linkedin.com/in/john" instead of the full https://www.linkedin.com/… URL.
function toLabel(v: string): string {
  return v
    .replace(/^https?:\/\/(www\.)?/i, "")
    .replace(/\/+$/, "");
}

export default function LinkedInField({ leadId, value }: { leadId: string; value: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const clean = v.trim();
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Empty string → server clears the field (stored as null).
        body: JSON.stringify({ linkedInUrl: clean }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 60)}`);
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setV(value ?? "");
    setEditing(false);
    setErr(null);
  }

  if (editing) {
    return (
      <div className="mt-0.5">
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={v}
            onChange={e => setV(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            placeholder="linkedin.com/in/username"
            className="border border-[#c9a24b] rounded px-2 py-1 text-sm w-full bg-white dark:bg-slate-700 dark:text-slate-100"
          />
          <button onClick={save} disabled={busy} aria-label="Save"
            className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
          <button onClick={cancel} aria-label="Cancel"
            className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
        </div>
        {err && <div className="text-[11px] text-red-600 mt-1">⚠ {err}</div>}
      </div>
    );
  }

  // Empty → just "Add Value".
  if (!value || !value.trim()) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-0.5 text-sm text-gray-400 italic hover:bg-amber-50 dark:hover:bg-slate-700 rounded px-1 -mx-1"
        title="Click to add LinkedIn"
      >
        Add Value
      </button>
    );
  }

  // Saved → clickable link + small pencil to edit.
  return (
    <div className="flex items-center gap-2 mt-0.5 min-w-0">
      <a
        href={toHref(value)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-blue-600 hover:underline dark:text-blue-400 truncate min-w-0"
        title={value}
      >
        {toLabel(value)}
      </a>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit LinkedIn"
        title="Edit"
        className="flex-none text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

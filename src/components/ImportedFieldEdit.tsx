"use client";

// Inline editor for a SINGLE imported (customFields) value on the lead detail.
// Admin / Super-Admin only — the parent ImportedFieldsCard renders this just for
// admins and falls back to plain read-only text for everyone else.
//
// Saving PATCHes /api/leads/[id]/update with { customFields: { [key]: value } },
// which MERGES the one key back into the JSON blob WITHOUT dropping the other
// imported columns, and writes a Change-History row "customFields.<key>" old→new.
// Mirrors the InlineEdit UX: click value → input + ✓/✕ → router.refresh.

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  leadId: string;
  fieldKey: string;     // the ORIGINAL imported header, used verbatim as the JSON key
  value: string;
}

export default function ImportedFieldEdit({ leadId, fieldKey, value }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFields: { [fieldKey]: v } }),
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
    setV(value);
    setEditing(false);
    setErr(null);
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className="cursor-pointer hover:bg-amber-50 dark:hover:bg-slate-700 rounded px-1 -mx-1 text-gray-800 dark:text-slate-200 break-words inline-block"
        title="Click to edit imported value"
      >
        {value === "" ? <span className="text-gray-400 italic">Add value</span> : value}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col w-full">
      <span className="inline-flex items-center gap-1">
        <input
          type="text"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className="border border-[#c9a24b] rounded px-2 py-1 text-sm w-full bg-white dark:bg-slate-700 dark:text-slate-100"
          autoFocus
        />
        <button onClick={save} disabled={busy} aria-label="Save"
          className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✓</button>
        <button onClick={cancel} aria-label="Cancel"
          className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-11 min-h-11 flex items-center justify-center">✕</button>
      </span>
      {err && <span className="text-[11px] text-red-600 mt-1">⚠ {err}</span>}
    </span>
  );
}

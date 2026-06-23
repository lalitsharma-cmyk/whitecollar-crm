"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Focused inline-edit for Buyer Data detail fields. Self-contained (PATCHes
// /api/buyer-data/[id]/update, which enforces an ADMIN gate + a field whitelist)
// so it never touches the lead edit path. Text / number / date only — the buyer
// fields that admins correct after an import.

type FieldType = "text" | "number" | "date";

interface Props {
  recordId: string;
  field: string;
  value: string | number | null;
  type?: FieldType;
  placeholder?: string;
  display?: string;       // formatted read-only override (e.g. compact money)
  className?: string;
}

export default function BuyerInlineEdit({ recordId, field, value, type = "text", placeholder, display, className }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      let payload: string | number | null = v.trim() === "" ? null : v;
      if (type === "number" && payload != null) {
        const n = parseFloat(String(payload).replace(/[^\d.-]/g, ""));
        if (isNaN(n)) { setErr("Enter a number."); setBusy(false); return; }
        payload = n;
      }
      const r = await fetch(`/api/buyer-data/${recordId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: payload }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  function cancel() { setV(value == null ? "" : String(value)); setEditing(false); setErr(null); }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded px-1 -mx-1 inline-block ${className ?? ""}`}
        title="Click to edit"
      >
        {value == null || value === ""
          ? <span className="text-gray-400 italic">Add</span>
          : <>{display ?? String(value)}</>}
      </span>
    );
  }

  const inputCls = "border border-[#c9a24b] rounded px-2 py-1 text-sm w-full";
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          type={type === "date" ? "date" : type === "number" ? "text" : "text"}
          inputMode={type === "number" ? "decimal" : undefined}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className={inputCls}
          placeholder={placeholder}
          autoFocus
        />
        <button onClick={save} disabled={busy} aria-label="Save" className="text-emerald-600 hover:bg-emerald-50 rounded p-2 text-base min-w-9 min-h-9 flex items-center justify-center">✓</button>
        <button onClick={cancel} aria-label="Cancel" className="text-red-600 hover:bg-red-50 rounded p-2 text-base min-w-9 min-h-9 flex items-center justify-center">✕</button>
      </span>
      {err && <span className="text-[11px] text-red-600 mt-1">⚠ {err}</span>}
    </span>
  );
}

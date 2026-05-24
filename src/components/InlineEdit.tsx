"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type FieldType = "text" | "textarea" | "number" | "date" | "select";

interface Props {
  leadId: string;
  field: string;       // backend field name
  label?: string;      // display label
  value: string | number | null;
  type?: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  multiline?: boolean;
  prefix?: string;     // displayed before value when read-only (e.g. "₹ ")
  className?: string;
}

export default function InlineEdit({ leadId, field, label, value, type = "text", options, placeholder, prefix, className }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value == null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: v }),
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
        className={`cursor-pointer hover:bg-amber-50 rounded px-1 -mx-1 inline-block ${className ?? ""}`}
        title="Click to edit"
      >
        {value == null || value === ""
          ? <span className="text-gray-400 italic">{placeholder ?? "click to set"}</span>
          : <>{prefix}{String(value)}</>}
        <span className="text-[10px] text-gray-400 ml-1">✎</span>
      </span>
    );
  }

  const inputCls = "border border-[#c9a24b] rounded px-2 py-1 text-sm w-full";

  const errLine = err ? <div className="text-[11px] text-red-600 mt-1">⚠ {err}</div> : null;

  if (type === "select" && options) {
    return (
      <div className="inline-flex flex-col">
        <div className="inline-flex items-center gap-1">
          <select value={v} onChange={(e) => setV(e.target.value)} className={inputCls} autoFocus>
            <option value="">—</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={save} disabled={busy} className="text-emerald-600 hover:bg-emerald-50 rounded p-1 text-xs">✓</button>
          <button onClick={cancel} className="text-red-600 hover:bg-red-50 rounded p-1 text-xs">✕</button>
        </div>
        {errLine}
      </div>
    );
  }

  if (type === "textarea") {
    return (
      <div>
        <textarea value={v} onChange={(e) => setV(e.target.value)} rows={4} className={inputCls + " min-h-[80px]"} autoFocus onKeyDown={(e) => { if (e.key === "Escape") cancel(); }} />
        <div className="flex gap-2 mt-1">
          <button onClick={save} disabled={busy} className="btn btn-primary text-xs py-1">{busy ? "..." : "Save"}</button>
          <button onClick={cancel} className="text-xs text-gray-500">Cancel</button>
        </div>
        {errLine}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          type={type === "number" ? "number" : type === "date" ? "datetime-local" : "text"}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
          className={inputCls}
          autoFocus
        />
        <button onClick={save} disabled={busy} className="text-emerald-600 hover:bg-emerald-50 rounded p-1 text-xs">✓</button>
        <button onClick={cancel} className="text-red-600 hover:bg-red-50 rounded p-1 text-xs">✕</button>
      </span>
      {errLine}
    </span>
  );
}

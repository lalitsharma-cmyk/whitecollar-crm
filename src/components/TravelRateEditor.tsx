"use client";
import { useState } from "react";

interface Props { initial: number; canEdit: boolean; }

export default function TravelRateEditor({ initial, canEdit }: Props) {
  const [val, setVal] = useState(String(initial));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  if (!canEdit) {
    return <div className="text-sm font-mono mt-2">₹ {initial} / km <span className="text-[10px] text-gray-500">(read-only — only Admin can change)</span></div>;
  }

  async function save() {
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch("/api/settings/travel-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perKmInr: Number(val) || 0 }),
      });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) setTimeout(() => setStatus("idle"), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div className="flex items-center gap-2 mt-2">
      <span className="text-sm font-mono">₹</span>
      <input
        type="number"
        min="0"
        step="0.5"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-24 border border-[#e5e7eb] rounded px-2 py-1 text-sm font-mono"
      />
      <span className="text-sm text-gray-500">per km</span>
      <button onClick={save} disabled={saving} className="btn btn-primary text-xs">{saving ? "Saving…" : "Save"}</button>
      {status === "saved" && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
      {status === "error" && <span className="text-xs text-red-600 font-semibold">✕ Failed</span>}
    </div>
  );
}

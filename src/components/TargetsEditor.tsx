"use client";
import { useState } from "react";

interface Props { userId: string; metric: string; initial: number; }

export default function TargetsEditor({ userId, metric, initial }: Props) {
  const [v, setV] = useState(String(initial));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function save() {
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch("/api/admin/targets/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, metric, value: Number(v) || 0 }),
      });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) setTimeout(() => setStatus("idle"), 1500);
    } finally { setSaving(false); }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min="0"
        step="1"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        className="w-20 border border-[#e5e7eb] rounded px-1 py-1 text-xs font-mono text-center"
      />
      {saving && <span className="text-[10px] text-gray-400">…</span>}
      {status === "saved" && <span className="text-[10px] text-emerald-600">✓</span>}
      {status === "error" && <span className="text-[10px] text-red-600">✕</span>}
    </span>
  );
}

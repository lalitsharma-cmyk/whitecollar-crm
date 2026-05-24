"use client";
import { useState } from "react";

interface Props { userId: string; initial: string | null; canEdit: boolean; }

export default function AcefoneAgentIdEdit({ userId, initial, canEdit }: Props) {
  const [v, setV] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  if (!canEdit) {
    return <span className="text-xs text-gray-500 font-mono">{initial ?? "—"}</span>;
  }

  async function save() {
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch(`/api/admin/users/${userId}/acefone`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acefoneAgentId: v.trim() || null }),
      });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) setTimeout(() => setStatus("idle"), 2000);
    } finally { setSaving(false); }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        placeholder="e.g. 1001"
        className="border border-[#e5e7eb] rounded px-2 py-1 text-xs font-mono w-24"
      />
      {saving && <span className="text-[10px] text-gray-400">…</span>}
      {status === "saved" && <span className="text-[10px] text-emerald-600">✓</span>}
      {status === "error" && <span className="text-[10px] text-red-600">✕</span>}
    </span>
  );
}

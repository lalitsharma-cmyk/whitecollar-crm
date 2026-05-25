"use client";
import { useState } from "react";

interface Props { userId: string; initial: string | null; canEdit: boolean; }

export default function WhatsAppNumberEdit({ userId, initial, canEdit }: Props) {
  const [v, setV] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  if (!canEdit) {
    return <span className="text-xs text-gray-500 font-mono">{initial ?? "—"}</span>;
  }

  async function save() {
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch(`/api/admin/users/${userId}/whatsapp-number`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyWhatsAppNumber: v.trim() || null }),
      });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) setTimeout(() => setStatus("idle"), 1500);
    } finally { setSaving(false); }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="tel"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        placeholder="+918XXXXXXX"
        className="border border-[#e5e7eb] rounded px-2 py-1 text-xs font-mono w-32"
      />
      {saving && <span className="text-[10px] text-gray-400">…</span>}
      {status === "saved" && <span className="text-[10px] text-emerald-600">✓</span>}
      {status === "error" && <span className="text-[10px] text-red-600">✕</span>}
    </span>
  );
}

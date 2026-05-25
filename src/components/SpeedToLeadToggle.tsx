"use client";
import { useState } from "react";

interface Props { initial: boolean; canEdit: boolean; }

export default function SpeedToLeadToggle({ initial, canEdit }: Props) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  if (!canEdit) {
    return (
      <div className="text-sm mt-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${on ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
          {on ? "✓ Enabled" : "○ Disabled"}
        </span>
        <span className="text-[10px] text-gray-500 ml-2">(read-only — only Admin can change)</span>
      </div>
    );
  }

  async function toggle(next: boolean) {
    setSaving(true); setStatus("idle");
    try {
      const r = await fetch("/api/settings/speed-to-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (r.ok) {
        setOn(next);
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
      }
    } finally { setSaving(false); }
  }

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={() => toggle(!on)}
        disabled={saving}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-gray-300"} ${saving ? "opacity-60" : ""}`}
        aria-pressed={on}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      <span className="text-sm font-semibold">{on ? "Enabled" : "Disabled"}</span>
      {status === "saved" && <span className="text-xs text-emerald-600 font-semibold">✓ Saved</span>}
      {status === "error" && <span className="text-xs text-red-600 font-semibold">✕ Failed</span>}
    </div>
  );
}

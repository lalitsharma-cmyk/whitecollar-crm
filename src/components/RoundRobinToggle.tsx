"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props { initial: boolean; canEdit: boolean; }

/**
 * Admin kill-switch for the 5-min round-robin auto-assigner.
 * Flip OFF before bulk-importing existing client lists so the imported rows
 * stay unassigned until admin manually routes them.
 */
export default function RoundRobinToggle({ initial, canEdit }: Props) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return <div className="text-sm mt-2">{on ? "✅ Round-robin is ON" : "⏸ Round-robin is OFF"} <span className="text-[10px] text-gray-500">(admin can change)</span></div>;
  }

  async function toggle() {
    setBusy(true);
    try {
      const r = await fetch("/api/settings/round-robin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !on }),
      });
      if (r.ok) { setOn(!on); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-amber-500"}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
      <span className={`text-sm font-semibold ${on ? "text-emerald-700" : "text-amber-700"}`}>
        {busy ? "Saving…" : on ? "✅ Round-robin ON — new leads auto-assign after 5 min" : "⏸ Round-robin OFF — new leads stay unassigned"}
      </span>
    </div>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; team: string | null; }

export default function LeadBulkActions({ selectedIds, agents, onClear }: { selectedIds: string[]; agents: Agent[]; onClear: () => void; }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState("");

  // ESC to clear selection
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClear(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClear]);

  if (selectedIds.length === 0) return null;

  async function bulkReassign() {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", ids: selectedIds, userId: picked }),
      });
      if (r.ok) { onClear(); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"} permanently? This can't be undone.`)) return;
    setBusy(true);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", ids: selectedIds }),
      });
      if (r.ok) { onClear(); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#0b1a33] text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
      <div className="text-sm font-semibold">{selectedIds.length} selected</div>
      <div className="w-px h-6 bg-white/20" />
      <select value={picked} onChange={(e) => setPicked(e.target.value)} className="bg-white/10 text-white border-0 rounded-lg px-2 py-1 text-xs">
        <option value="">Reassign to…</option>
        {agents.map(a => <option key={a.id} value={a.id} className="text-black">{a.name} ({a.team ?? "—"})</option>)}
      </select>
      <button onClick={bulkReassign} disabled={busy || !picked} className="text-xs font-semibold bg-[#c9a24b] text-[#0b1a33] px-3 py-1 rounded-lg">Reassign</button>
      <button onClick={bulkDelete} disabled={busy} className="text-xs font-semibold bg-red-600 text-white px-3 py-1 rounded-lg">Delete</button>
      <button onClick={onClear} className="text-xs text-white/70 hover:text-white">Clear</button>
    </div>
  );
}

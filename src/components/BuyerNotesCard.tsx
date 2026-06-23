"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// ── Buyer working notes (remarks) ────────────────────────────────────────────
// Free-text working notes for a buyer, RETAINED across reassignments (the
// remarks column). Editable by anyone who can touch the buyer (admin = any live;
// assigned agent = own ASSIGNED) — the PATCH route enforces canTouchBuyer + the
// remarks whitelist. Multi-line textarea (distinct from the single-line inline
// field edits). Sits ABOVE the Imported Fields card, which sits above the
// Conversation timeline (per the required detail layout).

export default function BuyerNotesCard({ buyerId, initial, canEdit }: { buyerId: string; initial: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/buyer-data/${buyerId}/update`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remarks: value.trim() || null }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? `Save failed (${r.status})`); setBusy(false); return; }
      setEditing(false);
      router.refresh();
    } catch (e) { setErr(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="card p-4" data-lead-section="notes">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="font-semibold dark:text-slate-100">🗒️ Notes <span className="text-[10px] text-gray-400 font-normal">— working notes, kept across reassignments</span></div>
        {canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-[#0b1a33] dark:text-blue-300 underline">{value ? "Edit" : "Add note"}</button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4}
            placeholder="Add working notes about this buyer…"
            className="w-full border border-[#c9a24b] rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100" autoFocus />
          {err && <div className="text-[11px] text-red-600">⚠ {err}</div>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={save} className="btn btn-primary text-sm disabled:opacity-40">Save</button>
            <button type="button" onClick={() => { setValue(initial ?? ""); setEditing(false); setErr(null); }} className="btn btn-ghost text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap break-words">{value || <span className="text-gray-400 italic">No notes yet.</span>}</div>
      )}
    </div>
  );
}

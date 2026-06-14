"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

export type LogNoteKind = "call" | "whatsapp" | "activity";

/** IST calendar-date key — must match the server gate in /log-note. */
function istDateKey(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Decide whether to SHOW the edit affordance (the server enforces it for real).
 * Admin/Manager: always. Agent: only their own entry, only on the IST day it was
 * logged (locks at midnight). entryUserId null (WhatsApp has no per-message user)
 * → ownership rides on the lead scope, so we allow same-day for the lead's viewer.
 */
export function canEditLogNote(opts: {
  viewerRole?: string | null;
  viewerId?: string | null;
  entryUserId?: string | null;
  loggedAt?: Date | string | null;
}): boolean {
  if (opts.viewerRole === "ADMIN" || opts.viewerRole === "MANAGER") return true;
  if (!opts.loggedAt) return false;
  const d = typeof opts.loggedAt === "string" ? new Date(opts.loggedAt) : opts.loggedAt;
  if (isNaN(d.getTime())) return false;
  const sameDay = istDateKey(d) === istDateKey(new Date());
  const own = opts.entryUserId == null || opts.entryUserId === opts.viewerId;
  return sameDay && own;
}

export default function EditableNote({
  leadId, kind, entryId, note, canEdit, emptyLabel = "Add a note", textClass,
}: {
  leadId: string;
  kind: LogNoteKind;
  entryId: string;
  note: string | null;
  canEdit: boolean;
  emptyLabel?: string;
  textClass?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/log-note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, entryId, note: val }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Couldn't save (${r.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setErr(`Network error — ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="mt-1">
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          rows={2}
          autoFocus
          className="w-full border border-[#e5e7eb] rounded-lg px-2 py-1.5 text-xs dark:bg-slate-700 dark:border-slate-600"
          placeholder={emptyLabel}
        />
        {err && <div className="text-[10px] text-red-600 mt-0.5">{err}</div>}
        <div className="flex gap-2 mt-1">
          <button onClick={save} disabled={busy} className="text-[10px] font-semibold px-2 py-1 rounded bg-[#0b1a33] text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
          <button onClick={() => { setEditing(false); setVal(note ?? ""); setErr(null); }} className="text-[10px] text-gray-500 px-2 py-1">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {note
        ? <div className={textClass}>{note}</div>
        : (canEdit ? <div className="text-xs text-gray-400 dark:text-slate-500 italic">{emptyLabel}</div> : null)}
      {canEdit && (
        <button
          onClick={() => { setVal(note ?? ""); setEditing(true); }}
          title="Edit note — today only (locks at midnight)"
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-[#0b1a33] dark:text-slate-500 dark:hover:text-blue-400"
        >
          <Pencil className="w-3 h-3" /> Edit
        </button>
      )}
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";

// Per-lead Notes card. Free-form text entries authored by agents/managers —
// distinct from Timeline (activity events) and Call History (structured call
// rows). The Note model has no `pinned` field, so this card only supports
// create + delete. Delete is restricted to the author or an ADMIN; the API
// enforces the same rule so the button isn't a free pass.

interface NoteItem {
  id: string;
  content: string;
  createdAt: string | Date;
  user: { id?: string | null; name: string; avatarColor: string | null } | null;
}

interface Props {
  leadId: string;
  initialNotes: NoteItem[];
  currentUserId: string;
  currentUserRole: string;
}

function relTime(d: string | Date): string {
  try {
    return formatDistanceToNow(new Date(d), { addSuffix: true });
  } catch {
    return "";
  }
}

export default function LeadNotesCard({ leadId, initialNotes, currentUserId, currentUserRole }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Track which note id is currently being deleted so we can disable just that
  // row's button instead of locking the entire card.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = currentUserRole === "ADMIN";

  async function saveNote() {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setDraft("");
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (deletingId) return;
    if (!confirm("Delete this note? This can't be undone.")) return;
    setDeletingId(noteId);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/notes/${noteId}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Delete failed (${r.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setDeletingId(null);
    }
  }

  const hasNotes = initialNotes.length > 0;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">📝 Notes <span className="text-[10px] text-gray-400 font-normal">({initialNotes.length})</span></div>
      </div>

      {/* Composer — always visible (the empty-state copy nudges to use it). */}
      <div className="space-y-2 mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Jot a note — context the next agent needs, client situation, follow-up reminder…"
          className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px] focus:outline-none focus:border-[#c9a24b]"
          maxLength={5000}
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] text-gray-400">{draft.length}/5000</div>
          <button
            type="button"
            onClick={saveNote}
            disabled={busy || draft.trim().length === 0}
            className="btn btn-primary text-xs py-1.5 px-3"
          >
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
        {err && <div className="text-xs text-red-600">⚠ {err}</div>}
      </div>

      {/* List */}
      {!hasNotes ? (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4 text-center">
          No notes yet. Add the first one.
        </div>
      ) : (
        <div className="space-y-3">
          {initialNotes.map((n) => {
            const canDelete = isAdmin || (n.user?.id != null && n.user.id === currentUserId);
            const avatar = n.user?.avatarColor ?? "bg-gray-400";
            const initial = (n.user?.name ?? "?").slice(0, 1).toUpperCase();
            return (
              <div key={n.id} className="flex gap-3 items-start border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                <div className={`w-7 h-7 rounded-full ${avatar} text-white flex items-center justify-center text-xs font-semibold flex-none`}>
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-xs text-gray-600">
                      <b className="text-gray-800">{n.user?.name ?? "System"}</b>
                      <span className="text-gray-400"> · {relTime(n.createdAt)}</span>
                    </div>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteNote(n.id)}
                        disabled={deletingId === n.id}
                        className="text-[10px] text-red-600 hover:text-red-800 disabled:opacity-50"
                        title="Delete note"
                      >
                        {deletingId === n.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </div>
                  <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words">{n.content}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

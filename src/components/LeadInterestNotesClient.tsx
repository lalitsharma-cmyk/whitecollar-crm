"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

interface InterestNote {
  id: string;
  noteText: string;
  autoDetected: boolean;
  sourceType: string | null;
  sourceDate: string | null;
  createdAt: string;
}

interface Unit {
  id: string;
  code: string;
  configuration: string;
  priceBase: number;
  project: { name: string; country: string };
}

interface Props {
  leadId: string;
  notes: InterestNote[];
  interestedUnits: Array<{
    id: string;
    type: string;
    unit: Unit;
  }>;
  userRole: "ADMIN" | "MANAGER" | "AGENT";
}

function sourceLabel(t: string): string {
  const m: Record<string, string> = {
    REMARK: "Imported remark", CALL_NOTE: "Call note",
    WA_MESSAGE: "WhatsApp", NOTE: "Note", MANUAL: "Manual",
  };
  return m[t] ?? t;
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "2-digit" }).format(new Date(iso));
  } catch { return ""; }
}

export default function LeadInterestNotesClient({
  leadId,
  notes: initialNotes,
  interestedUnits,
}: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function addNote() {
    if (!newText.trim() || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/interest-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteText: newText }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Couldn't add (${r.status}).`);
        return;
      }
      setAdding(false);
      setNewText("");
      router.refresh();
    } catch (e) {
      setErr(`Network error — ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  async function removeNote(id: string) {
    const r = await fetch(`/api/leads/${leadId}/interest-notes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      setNotes((arr) => arr.filter((n) => n.id !== id));
      router.refresh();
    }
  }

  async function runScan() {
    setScanning(true);
    try {
      await fetch(`/api/leads/${leadId}/detect-projects`, { method: "POST" });
      router.refresh();
    } finally { setScanning(false); }
  }

  const totalCount = notes.length + interestedUnits.length;

  return (
    <div>
      <div className="font-semibold mb-2 flex items-center gap-2">
        Interested properties
        <span className="chip src text-[10px]">({totalCount})</span>
      </div>

      {/* Auto-detected + manual notes */}
      {notes.length > 0 && (
        <div className="space-y-2 mb-3">
          {notes.map(n => (
            <div key={n.id} className="flex items-start justify-between border border-[#e5e7eb] rounded-lg p-2.5 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{n.noteText}</div>
                {n.autoDetected && n.sourceType && (
                  <div className="text-[10px] text-amber-600 mt-0.5">
                    🔍 {sourceLabel(n.sourceType)}{n.sourceDate ? ` · ${fmtDate(n.sourceDate)}` : ""}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeNote(n.id)}
                className="text-gray-400 hover:text-red-500 ml-2 flex-none"
                aria-label="Remove interest note"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Specific matched units */}
      {interestedUnits.length > 0 && (
        <div className="space-y-2 mb-3">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">Matched inventory</div>
          {interestedUnits.map(p => (
            <div key={p.id} className="flex items-center justify-between border border-[#e5e7eb] rounded-lg p-2 text-sm">
              <div>
                <div className="font-semibold">{p.unit.project.name} {p.unit.configuration}</div>
                <div className="text-xs text-gray-500">{p.unit.code}</div>
              </div>
              <span className={`chip ${p.type === "PRIMARY" ? "chip-hot" : p.type === "COMPARE" ? "chip-warm" : "chip-lost"}`}>
                {p.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {notes.length === 0 && interestedUnits.length === 0 && (
        <div className="text-sm text-gray-500 mb-2">None detected yet — add manually or scan.</div>
      )}

      {/* Manual add / scan */}
      {!adding ? (
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setAdding(true)}
            className="text-sm text-[#0b1a33] font-semibold flex items-center gap-1.5 min-h-11 px-1"
          >
            <Plus className="w-4 h-4" /> Add interest
          </button>
          <button
            onClick={runScan}
            disabled={scanning}
            className="text-sm text-amber-700 font-semibold flex items-center gap-1.5 min-h-11 px-1"
          >
            {scanning ? "Scanning…" : "🔍 Scan"}
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <input
            value={newText}
            onChange={e => setNewText(e.target.value)}
            placeholder="e.g. 2BR Business Bay under AED 2M"
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11"
          />
          {err && <div className="text-[11px] text-red-600">{err}</div>}
          <div className="flex gap-2">
            <button
              onClick={addNote}
              disabled={!newText.trim() || busy}
              className="btn btn-primary text-sm flex-1 justify-center min-h-11"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAdding(false); setNewText(""); }}
              className="btn btn-ghost text-sm flex-1 justify-center min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

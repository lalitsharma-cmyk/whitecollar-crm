"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Check } from "lucide-react";
import { useDismiss } from "@/lib/useDismiss";

// "Interested Properties" — the SAME picker toolkit as "Properties Discussed"
// (LeadProjectsClient): search existing project, free-text manual add, scan from
// conversation, accept/reject suggestions, remove. It saves to its OWN store
// (LeadInterestedProject via /interested-projects) so the two lists stay
// independent: a client may have discussed 10 properties but be interested in 2.
// Legacy free-text interest notes + matched units are still shown (and removable)
// beneath so no historical data is lost.

interface Project { id: string; name: string; city: string; country?: string; }
interface InterestedItem {
  projectId: string;
  project: { name: string; city: string };
  interestedAt: string;
  autoDetected?: boolean;
  suggestion?: boolean;
  sourceType?: string | null;
  sourceDate?: string | null;
  sourceText?: string | null;
}
interface LegacyNote {
  id: string;
  noteText: string;
  autoDetected: boolean;
  sourceType: string | null;
  sourceDate: string | null;
}
interface LegacyUnit {
  id: string;
  type: string;
  unit: { id: string; code: string; configuration: string; project: { name: string; country: string } };
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
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

export default function LeadInterestedClient({
  leadId,
  initial,
  allProjects,
  scopeCountry,
  legacyNotes,
  interestedUnits,
}: {
  leadId: string;
  initial: InterestedItem[];
  allProjects: Project[];
  scopeCountry?: string | null;
  legacyNotes: LegacyNote[];
  interestedUnits: LegacyUnit[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [notes, setNotes] = useState(legacyNotes);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Close the picker ONLY on a genuine outside interaction or Escape — never when a
  // text selection that began inside the search box happens to end outside. The shared
  // useDismiss helper also handles Escape (its default), running the same reset. (Was a
  // raw mousedown listener that dropped the box mid-selection.)
  const pickerRef = useDismiss<HTMLDivElement>(picking, () => {
    setPicking(false); setQuery(""); setHighlight(0);
  });

  const confirmed = items.filter(it => !it.suggestion);
  const suggested = items.filter(it => it.suggestion);

  const remaining = useMemo(
    () => allProjects.filter((p) => {
      if (items.some((it) => it.projectId === p.id)) return false;
      if (scopeCountry && p.country && p.country !== scopeCountry) return false;
      return true;
    }),
    [allProjects, items, scopeCountry],
  );

  const matches = useMemo(() => {
    const q = norm(query);
    if (!q) return remaining.slice(0, 50);
    return remaining.filter((p) => norm(`${p.name} ${p.city}`).includes(q)).slice(0, 50);
  }, [remaining, query]);

  async function addProject(projectId: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested-projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Couldn't add property (${r.status}).`);
        return;
      }
      setPicking(false); setQuery(""); setHighlight(0);
      router.refresh();
    } catch (e) {
      setErr(`Network error — ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  // Free-text add — for a property not yet in the Master. The API finds-or-creates
  // it (inactive, so it never affects auto-routing) and links it to the lead.
  async function addProjectByName(name: string) {
    const projectName = name.trim();
    if (!projectName || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested-projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectName }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Couldn't add "${projectName}" (${r.status}).`);
        return;
      }
      setPicking(false); setQuery(""); setHighlight(0);
      router.refresh();
    } catch (e) {
      setErr(`Network error — ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  async function removeProject(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested-projects`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (r.ok) {
        setItems((arr) => arr.filter((it) => it.projectId !== projectId));
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  async function acceptSuggestion(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested-projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, action: "accept" }),
      });
      if (r.ok) {
        setItems(arr => arr.map(it => it.projectId === projectId ? { ...it, suggestion: false } : it));
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  async function rejectSuggestion(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested-projects`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (r.ok) {
        setItems(arr => arr.filter(it => it.projectId !== projectId));
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  async function removeLegacyNote(id: string) {
    const r = await fetch(`/api/leads/${leadId}/interest-notes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) { setNotes((arr) => arr.filter((n) => n.id !== id)); router.refresh(); }
  }

  async function runScan() {
    setScanning(true);
    try {
      await fetch(`/api/leads/${leadId}/detect-projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: "interested" }),
      });
      router.refresh();
    } finally { setScanning(false); }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(matches.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[highlight];
      if (m) addProject(m.id);
      else if (query.trim()) addProjectByName(query);   // no match → save as free-text
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false); setQuery("");
    }
  }

  const totalCount = confirmed.length + notes.length + interestedUnits.length;

  return (
    <div>
      {/* ── Confirmed interested properties ──────────────────────────────── */}
      <div className="font-semibold mb-2 flex items-center gap-2">
        Interested properties
        <span className="chip src text-[10px]">({totalCount})</span>
      </div>
      {totalCount === 0 && <div className="text-sm text-gray-500 mb-2">None yet — add the properties this client is genuinely interested in.</div>}

      <div className="space-y-2">
        {confirmed.map((it) => (
          <div key={it.projectId} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 border border-[#e5e7eb] rounded-lg text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{it.project.name}</div>
              <div className="text-xs text-gray-500 truncate">{it.project.city}</div>
              {it.autoDetected && it.sourceType && (
                <div className="text-[10px] text-amber-600 mt-0.5">
                  🔍 Auto-detected · {sourceLabel(it.sourceType)}{it.sourceDate ? ` · ${fmtDate(it.sourceDate)}` : ""}
                </div>
              )}
              {it.sourceText && it.autoDetected && (
                <div className="text-[10px] text-gray-400 italic mt-0.5 truncate">&ldquo;{it.sourceText}&rdquo;</div>
              )}
            </div>
            <button
              onClick={() => removeProject(it.projectId)}
              disabled={busy}
              aria-label="Remove interested property"
              className="text-gray-400 hover:text-red-500 p-2 -m-2 flex-none min-w-11 min-h-11 flex items-center justify-center self-end sm:self-auto"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* ── Add property + scan buttons ──────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {!picking && (
          <button
            onClick={() => { setPicking(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="text-sm text-[#0b1a33] font-semibold mt-3 flex items-center gap-1.5 min-h-11 px-1"
          >
            <Plus className="w-4 h-4" /> Add property
          </button>
        )}
        <button
          onClick={runScan}
          disabled={scanning}
          className="text-sm text-amber-700 font-semibold mt-2 flex items-center gap-1.5 min-h-11 px-1"
        >
          {scanning ? "Scanning…" : "🔍 Scan for properties"}
        </button>
      </div>

      {picking && (
        <div ref={pickerRef} className="mt-3 flex flex-col gap-2">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder="Type property or city — e.g. 'Marina', 'Gurgaon', 'Burj'"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11"
              autoComplete="off"
            />
            {matches.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20">
                {matches.map((p, idx) => (
                  <div
                    key={p.id}
                    onMouseDown={(e) => { e.preventDefault(); addProject(p.id); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`px-3 py-2 text-sm cursor-pointer border-b border-[#f3f4f6] last:border-b-0 ${idx === highlight ? "bg-amber-50" : "hover:bg-gray-50"}`}
                  >
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.city}</div>
                  </div>
                ))}
              </div>
            )}
            {query.trim() && matches.length === 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20 overflow-hidden">
                <div
                  onMouseDown={(e) => { e.preventDefault(); addProjectByName(query); }}
                  className="px-3 py-2.5 text-sm cursor-pointer hover:bg-amber-50"
                >
                  ➕ Add &ldquo;<span className="font-semibold">{query.trim()}</span>&rdquo; as a new property
                </div>
              </div>
            )}
          </div>
          {err && <div className="text-[11px] text-red-600">{err}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => {
                const t = matches[highlight] ?? matches[0];
                if (t) addProject(t.id);
                else if (query.trim()) addProjectByName(query);   // free-text fallback
              }}
              disabled={busy || (matches.length === 0 && !query.trim())}
              className="btn btn-primary text-sm flex-1 justify-center min-h-11"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setPicking(false); setQuery(""); }}
              className="btn btn-ghost text-sm flex-1 justify-center min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Suggested (auto-detected via Scan, pending review) ───────────── */}
      {suggested.length > 0 && (
        <div className="mt-5 pt-4 border-t border-dashed border-blue-200">
          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-widest mb-2">
            🔍 Suggested — auto-detected from history ({suggested.length})
          </div>
          <div className="text-[10px] text-gray-500 mb-3">
            These property names were found in call notes, remarks, or WhatsApp. Accept the ones the client is genuinely interested in.
          </div>
          <div className="space-y-2">
            {suggested.map((it) => (
              <div key={it.projectId} className="p-2.5 border border-blue-200 bg-blue-50/60 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{it.project.name}</div>
                    <div className="text-xs text-gray-500">{it.project.city}</div>
                    {it.sourceType && (
                      <div className="text-[10px] text-blue-600 mt-0.5">
                        {sourceLabel(it.sourceType)}{it.sourceDate ? ` · ${fmtDate(it.sourceDate)}` : ""}
                      </div>
                    )}
                    {it.sourceText && (
                      <div className="text-[10px] text-gray-600 italic mt-1 bg-white/70 rounded px-1.5 py-1 border border-blue-100">
                        &ldquo;{it.sourceText}&rdquo;
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-none mt-0.5">
                    <button
                      onClick={() => acceptSuggestion(it.projectId)}
                      disabled={busy}
                      title="Accept — add to Interested Properties"
                      className="flex items-center gap-0.5 text-[10px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 min-h-8"
                    >
                      <Check className="w-3 h-3" /> Accept
                    </button>
                    <button
                      onClick={() => rejectSuggestion(it.projectId)}
                      disabled={busy}
                      title="Reject — remove suggestion"
                      className="flex items-center gap-0.5 text-[10px] px-2 py-1 rounded bg-white text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-50 min-h-8"
                    >
                      <X className="w-3 h-3" /> Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Earlier interest notes (legacy free-text) — preserved + removable ── */}
      {notes.length > 0 && (
        <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Earlier notes</div>
          <div className="space-y-2">
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
                  onClick={() => removeLegacyNote(n.id)}
                  className="text-gray-400 hover:text-red-500 ml-2 flex-none"
                  aria-label="Remove interest note"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Matched inventory (specific units) — read-only reference ──────── */}
      {interestedUnits.length > 0 && (
        <div className="mt-5 pt-4 border-t border-dashed border-gray-200">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2">Matched inventory</div>
          <div className="space-y-2">
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
        </div>
      )}
    </div>
  );
}

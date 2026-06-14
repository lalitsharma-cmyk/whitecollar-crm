"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus, Check } from "lucide-react";

interface Project { id: string; name: string; city: string; country?: string; }
interface Discussion {
  projectId: string;
  status: "DISCUSSED" | "SHORTLISTED" | "SITE_VISITED" | "RULED_OUT";
  project: { name: string; city: string };
  discussedAt: string;
  autoDetected?: boolean;
  suggestion?: boolean;
  sourceType?: string | null;
  sourceDate?: string | null;
  sourceText?: string | null;
}
interface UnmatchedMention {
  id: string;
  mentionText: string;
  sourceType: string;
  sourceDate: string | null;
  sourceText: string | null;
  resolved: boolean;
  resolvedIgnored: boolean;
}

const statusChip: Record<string, string> = {
  DISCUSSED:    "src",
  SHORTLISTED:  "chip-warm",
  SITE_VISITED: "chip-won",
  RULED_OUT:    "chip-lost",
};

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

export default function LeadProjectsClient({
  leadId,
  initial,
  allProjects,
  scopeCountry,
  unmatchedMentions,
  userRole,
}: {
  leadId: string;
  initial: Discussion[];
  allProjects: Project[];
  scopeCountry?: string | null;
  unmatchedMentions?: UnmatchedMention[];
  userRole?: "ADMIN" | "MANAGER" | "AGENT";
}) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click or Escape
  useEffect(() => {
    if (!picking) return;
    function handleOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPicking(false); setPicked(null); setQuery(""); setHighlight(0);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPicking(false); setPicked(null); setQuery(""); setHighlight(0);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [picking]);

  // Split into confirmed (user accepted or manually added) vs suggested (auto-detected pending)
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
    return remaining
      .filter((p) => norm(`${p.name} ${p.city}`).includes(q))
      .slice(0, 50);
  }, [remaining, query]);

  const unresolvedCount = (unmatchedMentions ?? []).filter(m => !m.resolved && !m.resolvedIgnored).length;

  async function addProject(projectId: string) {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: "DISCUSSED" }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? `Couldn't add project (${r.status}).`);
        return;
      }
      setPicking(false);
      setPicked(null);
      setQuery("");
      setHighlight(0);
      router.refresh();
    } catch (e) {
      setErr(`Network error — ${String(e).slice(0, 80)}`);
    } finally { setBusy(false); }
  }

  async function removeProject(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
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

  async function changeStatus(projectId: string, status: string) {
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status }),
      });
      router.refresh();
    } finally { setBusy(false); }
  }

  async function acceptSuggestion(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
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
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
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

  async function linkMention(id: string, projectId: string) {
    await fetch(`/api/admin/unmatched-mentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", projectId }),
    });
    router.refresh();
  }

  async function ignoreMention(id: string) {
    await fetch(`/api/admin/unmatched-mentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    });
    router.refresh();
  }

  async function runScan() {
    setScanning(true);
    try {
      await fetch(`/api/leads/${leadId}/detect-projects`, { method: "POST" });
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
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
      setPicked(null);
      setQuery("");
    }
  }

  return (
    <div>
      {/* ── Confirmed projects ───────────────────────────────────────────── */}
      <div className="font-semibold mb-2">Projects discussed</div>
      {confirmed.length === 0 && <div className="text-sm text-gray-500 mb-2">None yet — add a project once it&apos;s mentioned.</div>}
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
            <div className="flex items-center gap-2 flex-none">
              <select
                value={it.status}
                onChange={(e) => changeStatus(it.projectId, e.target.value)}
                disabled={busy}
                className={`chip ${statusChip[it.status]} border-0 outline-none text-[10px] flex-1 sm:flex-none min-h-11 sm:min-h-0`}
              >
                <option value="DISCUSSED">Discussed</option>
                <option value="SHORTLISTED">Shortlisted</option>
                <option value="SITE_VISITED">Site visited</option>
                <option value="RULED_OUT">Ruled out</option>
              </select>
              <button
                onClick={() => removeProject(it.projectId)}
                disabled={busy}
                aria-label="Remove project"
                className="text-gray-400 hover:text-red-500 p-2 -m-2 flex-none min-w-11 min-h-11 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── Add project + scan buttons ───────────────────────────────────── */}
      <div className="flex items-center gap-3">
        {!picking && remaining.length > 0 && (
          <button
            onClick={() => { setPicking(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="text-sm text-[#0b1a33] font-semibold mt-3 flex items-center gap-1.5 min-h-11 px-1"
          >
            <Plus className="w-4 h-4" /> Add project
          </button>
        )}
        <button
          onClick={runScan}
          disabled={scanning}
          className="text-sm text-amber-700 font-semibold mt-2 flex items-center gap-1.5 min-h-11 px-1"
        >
          {scanning ? "Scanning…" : "🔍 Scan for projects"}
        </button>
      </div>

      {picking && (
        <div ref={pickerRef} className="mt-3 flex flex-col gap-2">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPicked(null); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder="Type project or city — e.g. 'Marina', 'Gurgaon', 'Burj'"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11"
              autoComplete="off"
            />
            {matches.length > 0 && !picked && (
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
            {query && matches.length === 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 px-3 py-2 text-xs text-gray-500 bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20">
                No project matches &ldquo;{query}&rdquo;. Add it in /projects first.
              </div>
            )}
          </div>
          {err && <div className="text-[11px] text-red-600">{err}</div>}
          <div className="flex gap-2">
            <button
              onClick={() => { const t = picked ?? matches[highlight] ?? matches[0]; if (t) addProject(t.id); }}
              disabled={busy || (!picked && matches.length === 0)}
              className="btn btn-primary text-sm flex-1 justify-center min-h-11"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setPicking(false); setPicked(null); setQuery(""); }}
              className="btn btn-ghost text-sm flex-1 justify-center min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Suggested projects (auto-detected, pending review) ───────────── */}
      {suggested.length > 0 && (
        <div className="mt-5 pt-4 border-t border-dashed border-blue-200">
          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-widest mb-2">
            🔍 Suggested — auto-detected from history ({suggested.length})
          </div>
          <div className="text-[10px] text-gray-500 mb-3">
            These project names were found in call notes, remarks, or WhatsApp. Review each one and Accept or Reject.
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
                      title="Accept — add to Projects Discussed"
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

      {/* ── Unmatched mentions — ADMIN / MANAGER only ────────────────────── */}
      {unmatchedMentions && unmatchedMentions.length > 0 && (userRole === "ADMIN" || userRole === "MANAGER") && unresolvedCount > 0 && (
        <div className="mt-4 pt-4 border-t border-dashed border-amber-200">
          <div className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest mb-2">
            ⚠️ Unmatched project mentions ({unresolvedCount})
          </div>
          {unmatchedMentions.filter(m => !m.resolved && !m.resolvedIgnored).map(m => (
            <div key={m.id} className="flex flex-col gap-1 p-2 border border-amber-200 bg-amber-50 rounded-lg mb-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-amber-800">&ldquo;{m.mentionText}&rdquo;</span>
                <span className="text-[10px] text-gray-500">{sourceLabel(m.sourceType)}</span>
              </div>
              {m.sourceText && <div className="text-[10px] text-gray-500 italic">…{m.sourceText}…</div>}
              <div className="flex gap-2 mt-1">
                <select
                  className="text-xs border border-amber-300 rounded px-1 py-0.5 flex-1 bg-white"
                  defaultValue=""
                  onChange={(e) => e.target.value && linkMention(m.id, e.target.value)}
                >
                  <option value="">Link to project…</option>
                  {allProjects
                    .filter(p => !scopeCountry || !p.country || p.country === scopeCountry)
                    .map(p => <option key={p.id} value={p.id}>{p.name} ({p.city})</option>)}
                </select>
                <button
                  onClick={() => ignoreMention(m.id)}
                  className="text-[10px] text-gray-500 hover:text-red-500 px-2 py-0.5 border border-gray-200 rounded"
                >
                  Ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

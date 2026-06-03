"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";

interface Project { id: string; name: string; city: string; country?: string; }
interface Discussion {
  projectId: string;
  status: "DISCUSSED" | "SHORTLISTED" | "SITE_VISITED" | "RULED_OUT";
  project: { name: string; city: string };
  discussedAt: string;
  autoDetected?: boolean;
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
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status: "DISCUSSED" }),
      });
      if (r.ok) router.refresh();
      setPicking(false);
      setPicked(null);
      setQuery("");
      setHighlight(0);
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

  async function linkMention(id: string, projectId: string) {
    await fetch(`/api/admin/unmatched-mentions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", projectId }),
    });
    router.refresh();
  }

  async function ignoreMention(id: string) {
    await fetch(`/api/admin/unmatched-mentions/${id}`, {
      method: "POST",
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
      if (m) {
        setPicked(m);
        setQuery(`${m.name} (${m.city})`);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
      setPicked(null);
      setQuery("");
    }
  }

  return (
    <div>
      <div className="font-semibold mb-2">Projects discussed</div>
      {items.length === 0 && <div className="text-sm text-gray-500 mb-2">None yet — add a project once it&apos;s mentioned.</div>}
      <div className="space-y-2">
        {items.map((it) => (
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
      <div className="flex items-center gap-3">
        {!picking && remaining.length > 0 && (
          <button
            onClick={() => {
              setPicking(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
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
        <div className="mt-3 flex flex-col gap-2">
          <div className="relative">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
                setHighlight(0);
              }}
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
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setPicked(p);
                      setQuery(`${p.name} (${p.city})`);
                    }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`px-3 py-2 text-sm cursor-pointer border-b border-[#f3f4f6] last:border-b-0 ${
                      idx === highlight ? "bg-amber-50" : "hover:bg-gray-50"
                    }`}
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
          <div className="flex gap-2">
            <button
              onClick={() => picked && addProject(picked.id)}
              disabled={!picked || busy}
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

      {/* Unmatched mentions — ADMIN / MANAGER only */}
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
                  {allProjects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.city})</option>)}
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

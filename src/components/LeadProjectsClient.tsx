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
}

const statusChip: Record<string, string> = {
  DISCUSSED:    "src",
  SHORTLISTED:  "chip-warm",
  SITE_VISITED: "chip-won",
  RULED_OUT:    "chip-lost",
};

// Lower-case + remove non-alphanumerics. Cheap normalisation so the user can
// type "marinaBay 1" / "marina-bay 1" / "Marina Bay 1" and they all match.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function LeadProjectsClient({
  leadId,
  initial,
  allProjects,
  /**
   * Optional defensive secondary filter. When set (e.g. "UAE" or "India"),
   * the picker only surfaces projects whose `country` matches. The parent
   * page is expected to already pre-filter `allProjects`, but this provides
   * belt-and-braces protection in case the parent forgets. Pass null/omit
   * for admin/manager (no extra filter).
   */
  scopeCountry,
}: { leadId: string; initial: Discussion[]; allProjects: Project[]; scopeCountry?: string | null; }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const remaining = useMemo(
    () => allProjects.filter((p) => {
      if (items.some((it) => it.projectId === p.id)) return false;
      // Defensive secondary scope — only drop a row if BOTH the scope and the
      // project's country are known and they disagree. Unknown country on a
      // project means "show it" (don't hide data we can't classify).
      if (scopeCountry && p.country && p.country !== scopeCountry) return false;
      return true;
    }),
    [allProjects, items, scopeCountry],
  );

  // Fuzzy substring match on normalised "name + city". Limits the dropdown
  // to 50 hits so we don't paint thousands of rows when the query is empty.
  const matches = useMemo(() => {
    const q = norm(query);
    if (!q) return remaining.slice(0, 50);
    return remaining
      .filter((p) => norm(`${p.name} ${p.city}`).includes(q))
      .slice(0, 50);
  }, [remaining, query]);

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
      {items.length === 0 && <div className="text-sm text-gray-500 mb-2">None yet — add a project once it's mentioned.</div>}
      <div className="space-y-2">
        {items.map((it) => (
          // Mobile-friendly row: stacks vertically on small screens so the project
          // name + status chip + delete don't get squashed together (the old single-row
          // layout broke on phones — name truncated, chip+x overlapped).
          <div key={it.projectId} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 border border-[#e5e7eb] rounded-lg text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{it.project.name}</div>
              <div className="text-xs text-gray-500 truncate">{it.project.city}</div>
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
      {picking && (
        // Typeahead picker: type to filter by name OR city. Arrow keys + Enter
        // for power users, click for everyone else. No new API — we fuzzy
        // match the `allProjects` prop already passed down by the server.
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
            {/* Dropdown — render only while picking and we have at least one
                hit. Caps at 50 rows (matches.slice in useMemo above). */}
            {matches.length > 0 && !picked && (
              <div className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border border-[#e5e7eb] rounded-lg shadow-lg z-20">
                {matches.map((p, idx) => (
                  <div
                    key={p.id}
                    onMouseDown={(e) => {
                      // onMouseDown so the input's onBlur doesn't fire and
                      // close the dropdown before this click registers.
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
                No project matches "{query}". Add it in /projects first.
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
    </div>
  );
}

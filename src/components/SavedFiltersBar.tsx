"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Bookmark, BookmarkPlus, X, Trash2, Pencil } from "lucide-react";
import { canonicalizeQuery, queriesMatch } from "@/lib/savedFilters";

interface SavedFilter {
  id: string; name: string; icon: string | null; queryString: string;
  isShared: boolean; isOwn: boolean; isSystem: boolean;
}

/**
 * Quick-select bar above the LeadFilters on /leads. Shows saved views as
 * clickable chips, with the active one highlighted. Has a "💾 Save current"
 * button that snapshots the current URL params into a new SavedFilter.
 *
 * Lives above LeadFilters because it's the "quick-pick" layer; LeadFilters
 * is the "construct one" layer.
 */
export default function SavedFiltersBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveIcon, setSaveIcon] = useState("⭐");

  // Strip pagination / sort from comparison — these are view prefs, not filters
  function viewParams(qs: string): string {
    const p = new URLSearchParams(qs);
    p.delete("page");
    return canonicalizeQuery(p.toString());
  }

  const currentQuery = viewParams(sp.toString());

  async function load() {
    try {
      const r = await fetch("/api/saved-filters", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setFilters(j.items ?? []);
      setLoaded(true);
    } catch {}
  }
  useEffect(() => { load(); }, []);

  function apply(qs: string) {
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  async function saveCurrent() {
    if (saving || !saveName.trim()) return;
    setSaving(true);
    try {
      const r = await fetch("/api/saved-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), icon: saveIcon || "⭐", queryString: currentQuery, isShared: true }),
      });
      if (r.ok) {
        setShowSaveDialog(false);
        setSaveName("");
        setSaveIcon("⭐");
        await load();
      }
    } finally { setSaving(false); }
  }

  async function remove(f: SavedFilter) {
    if (!confirm(`Delete saved filter "${f.name}"?`)) return;
    const r = await fetch(`/api/saved-filters/${f.id}`, { method: "DELETE" });
    if (r.ok) await load();
  }

  const hasCurrentFilters = currentQuery.length > 0;
  // Match by canonical query strings — order of keys doesn't matter
  const activeFilter = filters.find((f) => queriesMatch(f.queryString, currentQuery));

  if (!loaded) {
    return <div className="card p-2 text-xs text-gray-400">Loading saved filters…</div>;
  }

  return (
    <>
      <div className="card p-2 flex flex-wrap items-center gap-1.5">
        <Bookmark className="w-3.5 h-3.5 text-gray-400 ml-1" />
        <span className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mr-1">Smart lists</span>

        {/* "All" chip (no query) */}
        <Link
          href={pathname}
          className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition ${currentQuery === "" ? "bg-[#0b1a33] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >📋 All leads</Link>

        {filters.map((f) => {
          const isActive = activeFilter?.id === f.id;
          return (
            <span key={f.id} className="inline-flex items-center group">
              <button
                onClick={() => apply(f.queryString)}
                className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition ${isActive ? "bg-[#c9a24b] text-[#0b1a33]" : "bg-gray-100 text-gray-700 hover:bg-amber-50 hover:text-[#0b1a33]"}`}
                title={`Apply filter · ${f.queryString}`}
              >
                {f.icon ?? "⭐"} {f.name}
              </button>
              {(f.isOwn || !f.isSystem) && (
                <button
                  onClick={() => remove(f)}
                  className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-400 hover:text-red-600 p-0.5 transition"
                  title={`Delete "${f.name}"`}
                ><Trash2 className="w-3 h-3" /></button>
              )}
            </span>
          );
        })}

        {hasCurrentFilters && !activeFilter && (
          <button
            onClick={() => setShowSaveDialog(true)}
            className="text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 inline-flex items-center gap-1"
            title="Save current filter combination as a new Smart List"
          >
            <BookmarkPlus className="w-3 h-3" /> Save current
          </button>
        )}
      </div>

      {showSaveDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setShowSaveDialog(false)}>
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">💾 Save filter as Smart List</div>
              <button onClick={() => setShowSaveDialog(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">Saved as: <code className="bg-gray-50 px-1 rounded text-[10px] break-all">{currentQuery}</code></p>
            <label className="text-xs font-semibold text-gray-600">Icon (emoji)</label>
            <input value={saveIcon} onChange={(e) => setSaveIcon(e.target.value)} maxLength={4} placeholder="⭐" className="w-16 mt-1 mb-3 text-center text-lg border border-[#e5e7eb] rounded-lg px-2 py-1" />
            <label className="text-xs font-semibold text-gray-600">Name</label>
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="e.g. Hot Dubai NRI" className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" autoFocus />
            <p className="text-[10px] text-gray-500 mb-3">Shared with the whole team. Anyone can apply it; only you (or admin) can delete it.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSaveDialog(false)} disabled={saving} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={saveCurrent} disabled={saving || !saveName.trim()} className="btn btn-primary text-sm">{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

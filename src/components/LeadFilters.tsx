"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface Props {
  agents: { id: string; name: string }[];
  sources: string[];
  statuses: string[];
  /** Leadership-only flag — false for AGENT. Hides Source and Owner. */
  showSource?: boolean;
  /** DISTINCT tags from the dataset for the tag-filter dropdown. */
  distinctTags?: string[];
}

export default function LeadFilters({
  agents, sources, statuses, showSource = true, distinctTags = [],
}: Props) {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();

  // ── Search (debounced) ─────────────────────────────────────────────────────
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") === q) return;
      const p = new URLSearchParams(sp);
      if (q) p.set("q", q); else p.delete("q");
      p.delete("page");
      router.replace(`${pathname}?${p.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── More-Filters drawer ────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);

  // Draft state — initialised from URL when drawer opens
  const [draftSource,     setDraftSource]     = useState("");
  const [draftStatus,     setDraftStatus]     = useState("");
  const [draftAI,         setDraftAI]         = useState("");
  const [draftTeam,       setDraftTeam]       = useState("");
  const [draftOwner,      setDraftOwner]      = useState("");
  const [draftSort,       setDraftSort]       = useState("");
  const [draftTag,        setDraftTag]        = useState("");
  const [draftNotPicked,  setDraftNotPicked]  = useState("");
  const [draftFollowup,   setDraftFollowup]   = useState("");
  const [draftDateFrom,   setDraftDateFrom]   = useState(sp.get("dateFrom") ?? "");
  const [draftDateTo,     setDraftDateTo]     = useState(sp.get("dateTo") ?? "");
  const [draftDateField,  setDraftDateField]  = useState(sp.get("dateField") ?? "followupDate");

  function openDrawer() {
    setDraftSource(sp.get("source") ?? "");
    setDraftStatus(sp.get("status") ?? "");
    setDraftAI(sp.get("ai") ?? "");
    setDraftTeam(sp.get("team") ?? "");
    setDraftOwner(sp.get("owner") ?? "");
    setDraftSort(sp.get("sort") ?? "");
    setDraftTag(sp.get("tag") ?? "");
    setDraftNotPicked(sp.get("notPicked") ?? "");
    setDraftFollowup(sp.get("followup") ?? "");
    setDraftDateFrom(sp.get("dateFrom") ?? "");
    setDraftDateTo(sp.get("dateTo") ?? "");
    setDraftDateField(sp.get("dateField") ?? "followupDate");
    setOpen(true);
  }

  function applyFilters() {
    const p = new URLSearchParams(sp);
    const set = (k: string, v: string) => v ? p.set(k, v) : p.delete(k);
    set("source",    draftSource);
    set("status",    draftStatus);
    set("ai",        draftAI);
    set("team",      draftTeam);
    set("owner",     draftOwner);
    set("sort",      draftSort);
    set("tag",       draftTag);
    set("notPicked", draftNotPicked);
    set("followup",  draftFollowup);
    set("dateFrom",  draftDateFrom);
    set("dateTo",    draftDateTo);
    set("dateField", draftDateField);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  function resetFilters() {
    const p = new URLSearchParams(sp);
    ["source","status","ai","team","owner","sort","tag","notPicked","followup","smart","filter","when","eoi","dateFrom","dateTo","dateField"]
      .forEach(k => p.delete(k));
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
    setOpen(false);
  }

  // Badge: count of active drawer-managed params
  const advancedCount = [
    sp.get("source"), sp.get("status"), sp.get("ai"),
    sp.get("team"),   sp.get("owner"),  sp.get("sort"),
    sp.get("tag"),    sp.get("notPicked"),
    sp.get("smart"),  sp.get("filter"),
    sp.get("dateFrom"), sp.get("dateTo"),
  ].filter(Boolean).length;

  const selCls = "w-full border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg px-3 py-2 text-sm";
  const lblCls = "text-xs font-semibold text-gray-500 dark:text-slate-400 block mb-1";

  return (
    <>
      {/* ── Search row ───────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search name / phone / email / company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20"
        />
        <button
          type="button"
          onClick={openDrawer}
          className={[
            "relative flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap",
            advancedCount > 0
              ? "border-[#0b1a33] bg-[#0b1a33] text-white dark:border-blue-500 dark:bg-blue-700"
              : "border-[#e5e7eb] dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-100 hover:border-gray-400 dark:hover:border-slate-400",
          ].join(" ")}
          aria-label="Open advanced filters"
        >
          {/* Filter icon */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
            <circle cx="9"  cy="6"  r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="16" cy="12" r="2.5" fill="currentColor" stroke="none"/>
            <circle cx="9"  cy="18" r="2.5" fill="currentColor" stroke="none"/>
          </svg>
          Filters
          {advancedCount > 0 && (
            <span className="bg-white/25 rounded px-1.5 text-xs font-bold">{advancedCount}</span>
          )}
        </button>
      </div>

      {/* ── More-Filters drawer ───────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 dark:bg-black/70" aria-hidden />

          {/* Sheet */}
          <div className="relative bg-white dark:bg-slate-800 w-full sm:w-[400px] rounded-t-2xl sm:rounded-2xl shadow-2xl z-10 overflow-hidden">

            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full bg-gray-300 dark:bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">More Filters</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 rounded-full transition-colors"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Filter controls */}
            <div className="px-5 pb-4 space-y-3 overflow-y-auto" style={{ maxHeight: "60vh" }}>
              {/* Follow-up */}
              <div>
                <label className={lblCls}>📅 Follow-up</label>
                <select value={draftFollowup} onChange={(e) => setDraftFollowup(e.target.value)} className={selCls}>
                  <option value="">All leads</option>
                  <option value="overdue">⏰ Overdue</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                </select>
              </div>

              {/* Stage */}
              <div>
                <label className={lblCls}>Stage</label>
                <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value)} className={selCls}>
                  <option value="">All stages</option>
                  {statuses.filter(s => s !== "WON" && s !== "LOST")
                    .map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                </select>
              </div>

              {/* Potential (AI score) */}
              <div>
                <label className={lblCls}>Potential</label>
                <select value={draftAI} onChange={(e) => setDraftAI(e.target.value)} className={selCls}>
                  <option value="">Any score</option>
                  <option value="HOT">🔥 Hot</option>
                  <option value="WARM">☀ Warm</option>
                  <option value="COLD">🧊 Cold</option>
                </select>
              </div>

              {/* Not picking — only show if showSource (leadership) */}
              <div>
                <label className={lblCls}>📵 Not picking calls</label>
                <select value={draftNotPicked} onChange={(e) => setDraftNotPicked(e.target.value)} className={selCls}>
                  <option value="">Any</option>
                  <option value="2">Not picking 2+ days</option>
                  <option value="3">Not picking 3+ days</option>
                  <option value="5">Not picking 5+ days</option>
                  <option value="7">Not picking 7+ days</option>
                </select>
              </div>

              {/* Source — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Source</label>
                  <select value={draftSource} onChange={(e) => setDraftSource(e.target.value)} className={selCls}>
                    <option value="">All sources</option>
                    {sources.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
                  </select>
                </div>
              )}

              {/* Team — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Team</label>
                  <select value={draftTeam} onChange={(e) => setDraftTeam(e.target.value)} className={selCls}>
                    <option value="">All teams</option>
                    <option value="Dubai">Dubai</option>
                    <option value="India">India</option>
                  </select>
                </div>
              )}

              {/* Owner — leadership only */}
              {showSource && (
                <div>
                  <label className={lblCls}>Owner</label>
                  <select value={draftOwner} onChange={(e) => setDraftOwner(e.target.value)} className={selCls}>
                    <option value="">All owners</option>
                    <option value="unassigned">⚠ Unassigned</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
              )}

              {/* Tag */}
              {distinctTags.length > 0 && (
                <div>
                  <label className={lblCls}>Tag</label>
                  <select value={draftTag} onChange={(e) => setDraftTag(e.target.value)} className={selCls}>
                    <option value="">All tags</option>
                    {distinctTags.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              )}

              {/* Sort */}
              <div>
                <label className={lblCls}>Sort by</label>
                <select value={draftSort} onChange={(e) => setDraftSort(e.target.value)} className={selCls}>
                  <option value="">Newest first</option>
                  <option value="created_asc">Oldest first</option>
                  <option value="score_desc">AI score: high → low</option>
                  <option value="touched_asc">Stalest first</option>
                  <option value="touched_desc">Recently touched</option>
                  <option value="name_asc">Name A–Z</option>
                </select>
              </div>

              {/* Date range filter */}
              <div>
                <label className={lblCls}>📅 Date Range Filter</label>
                <select value={draftDateField} onChange={(e) => setDraftDateField(e.target.value)} className={selCls + " mb-2"}>
                  <option value="followupDate">Follow-up Date</option>
                  <option value="createdAt">Created Date</option>
                  <option value="lastTouchedAt">Last Activity Date</option>
                </select>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-500 dark:text-slate-400 block mb-0.5">From</label>
                    <input type="date" value={draftDateFrom} onChange={(e) => setDraftDateFrom(e.target.value)}
                      className={selCls} />
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-500 dark:text-slate-400 block mb-0.5">To</label>
                    <input type="date" value={draftDateTo} onChange={(e) => setDraftDateTo(e.target.value)}
                      className={selCls} />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-5 py-4 bg-gray-50 dark:bg-slate-900/60 border-t border-gray-100 dark:border-slate-700">
              <button type="button" onClick={applyFilters} className="btn btn-primary flex-1 justify-center">
                Apply
              </button>
              <button type="button" onClick={resetFilters} className="btn btn-ghost flex-1 justify-center">
                Reset All
              </button>
            </div>
          </div>
        </div>
      )}

      {(sp.get("dateFrom") || sp.get("dateTo")) && (
        <div className="flex items-center gap-2 text-xs bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-3 py-2 mt-2">
          <span className="text-blue-700 dark:text-blue-300 font-medium">
            📅 Date filter: {sp.get("dateField") === "createdAt" ? "Created" : sp.get("dateField") === "lastTouchedAt" ? "Last activity" : "Follow-up"}
            {" "}{sp.get("dateFrom") || "∞"} → {sp.get("dateTo") || "∞"}
          </span>
          <button onClick={() => {
            const p = new URLSearchParams(sp.toString());
            ["dateFrom", "dateTo", "dateField"].forEach(k => p.delete(k));
            p.delete("page");
            router.replace(`${pathname}?${p.toString()}`);
          }} className="ml-auto text-blue-500 hover:text-blue-700 font-semibold">✕ Clear</button>
        </div>
      )}
    </>
  );
}

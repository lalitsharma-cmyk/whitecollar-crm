"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface Props {
  agents: { id: string; name: string }[];
  sources: string[];
  statuses: string[];
  /** Hide the Source filter dropdown — agents should not see where leads came from. */
  showSource?: boolean;
}

export default function LeadFilters({ agents, sources, statuses, showSource = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  // Debounce text search
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

  function update(key: string, value: string) {
    const p = new URLSearchParams(sp);
    if (value) p.set(key, value); else p.delete(key);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  const [showFilters, setShowFilters] = useState(false);
  return (
    <div className="card p-3 lg:p-4 space-y-2 lg:space-y-0 lg:flex lg:flex-wrap lg:gap-2 lg:items-center">
      <input
        type="search"
        placeholder="Search name / phone / email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm w-full lg:flex-1 lg:min-w-[200px]"
      />
      <button onClick={() => setShowFilters((s) => !s)} className="lg:hidden btn btn-ghost text-xs w-full justify-center">
        {showFilters ? "Hide filters ▴" : "Show filters ▾"}
      </button>
      <div className={`${showFilters ? "block" : "hidden"} lg:flex lg:flex-wrap lg:gap-2 lg:items-center grid grid-cols-2 gap-2 mt-2 lg:mt-0`}>
      {showSource && (
        <select value={sp.get("source") ?? ""} onChange={(e) => update("source", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
        </select>
      )}
      <select value={sp.get("status") ?? ""} onChange={(e) => update("status", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="">All stages</option>
        {statuses.filter(s => s !== "WON" && s !== "LOST").map(s => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}
      </select>
      <select value={sp.get("ai") ?? ""} onChange={(e) => update("ai", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="">AI: any</option>
        <option value="HOT">🔥 Hot</option>
        <option value="WARM">☀ Warm</option>
        <option value="COLD">🧊 Cold</option>
      </select>
      <select value={sp.get("team") ?? ""} onChange={(e) => update("team", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="">All teams</option>
        <option value="Dubai">Dubai</option>
        <option value="India">India</option>
      </select>
      <select value={sp.get("owner") ?? ""} onChange={(e) => update("owner", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="">All owners</option>
        <option value="unassigned">⚠ Unassigned</option>
        {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select value={sp.get("when") ?? ""} onChange={(e) => update("when", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="">Any time</option>
        <option value="24h">Last 24 hours</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="overdue">Touch &gt;5 days ago</option>
      </select>
      <select value={sp.get("sort") ?? "created_desc"} onChange={(e) => update("sort", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
        <option value="created_desc">Newest first</option>
        <option value="created_asc">Oldest first</option>
        <option value="score_desc">AI score: high → low</option>
        <option value="touched_asc">Stalest first</option>
        <option value="touched_desc">Recently touched</option>
        <option value="name_asc">Name A-Z</option>
      </select>
        {Array.from(sp.entries()).length > 0 && (
          <button onClick={() => router.replace(pathname)} className="col-span-2 lg:col-span-1 text-xs text-gray-500 hover:text-[#0b1a33] underline">Clear all filters</button>
        )}
      </div>
    </div>
  );
}

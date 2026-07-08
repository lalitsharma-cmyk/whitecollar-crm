"use client";
// GLOBAL SEARCH command palette — the header search box + Ctrl/Cmd+K.
// Mounts once at the shell. Searches EVERY lead-based module (Leads / Master Data /
// Revival Engine / Dubai Buyer Data / India Buyer Data) via /api/quick-search, which
// enforces role scope server-side. Starts at 3 chars, debounced 300 ms, results are
// grouped by module and each card shows Name · Mobile · Agent · Status. Clicking (or
// Enter) opens that record's shared detail page. Arrow keys navigate; Esc closes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { backdropProps } from "@/lib/useDismiss";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;

interface SearchHit {
  recordType: "lead" | "buyer";
  module: string;
  id: string;
  name: string;
  phone: string | null;
  agent: string;
  status: string;
  href: string;
}
interface ProjectHit {
  id: string;
  name: string;
  city: string;
  country: string;
}
interface SearchResults {
  results: SearchHit[];
  projects: ProjectHit[];
}

const EMPTY: SearchResults = { results: [], projects: [] };

// Fixed module order + badge colour. Every result carries its module label.
const MODULE_ORDER = ["Leads", "Master Data", "Revival Engine", "Dubai Buyer Data", "India Buyer Data"] as const;
const MODULE_BADGE: Record<string, string> = {
  "Leads": "bg-blue-100 text-blue-700",
  "Master Data": "bg-slate-200 text-slate-700",
  "Revival Engine": "bg-purple-100 text-purple-700",
  "Dubai Buyer Data": "bg-amber-100 text-amber-800",
  "India Buyer Data": "bg-emerald-100 text-emerald-700",
};

// One flat navigable list: every module's hits in order, then projects last, so
// ArrowUp/Down + Enter have a stable index across all groups.
interface FlatItem { href: string; hit?: SearchHit; project?: ProjectHit; }

export default function QuickSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const byModule = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const label of MODULE_ORDER) m.set(label, []);
    for (const h of data.results) {
      if (!m.has(h.module)) m.set(h.module, []);
      m.get(h.module)!.push(h);
    }
    return m;
  }, [data.results]);

  const flat: FlatItem[] = useMemo(() => {
    const out: FlatItem[] = [];
    for (const label of MODULE_ORDER) for (const h of byModule.get(label) ?? []) out.push({ href: h.href, hit: h });
    // any module label the server returned that isn't in the fixed order (future-proof)
    for (const [label, hits] of byModule) if (!MODULE_ORDER.includes(label as (typeof MODULE_ORDER)[number])) for (const h of hits) out.push({ href: h.href, hit: h });
    for (const p of data.projects) out.push({ href: "/properties", project: p });
    return out;
  }, [byModule, data.projects]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ(""); setData(EMPTY); setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => { setHighlight((h) => (h >= flat.length ? 0 : h)); }, [flat.length]);

  // ── debounced fetch (300 ms), starts at 3 chars ──
  useEffect(() => {
    if (!open) return;
    const query = q.replace(/\s+/g, " ").trim();
    if (query.length < MIN_CHARS) { setData(EMPTY); setLoading(false); return; }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quick-search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        setData(res.ok ? await res.json() : EMPTY);
      } catch {
        /* aborted / network — keep previous */
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const close = useCallback(() => setOpen(false), []);
  const select = useCallback((item: FlatItem | undefined) => {
    if (!item) return;
    close();
    router.push(item.href);
  }, [close, router]);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (flat.length === 0 ? 0 : (h + 1) % flat.length)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => (flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length)); }
    else if (e.key === "Enter") { e.preventDefault(); select(flat[highlight]); }
  }

  if (!open) return null;

  const query = q.replace(/\s+/g, " ").trim();
  let cursor = 0;

  return (
    <div className="fixed inset-0 z-[100] bg-black/50" {...backdropProps(close)} role="dialog" aria-modal="true" aria-label="Global search">
      <div
        className="mx-auto w-[92vw] max-w-2xl bg-white dark:bg-slate-900 rounded-xl border-2 border-[#c9a24b] shadow-2xl overflow-hidden"
        style={{ marginTop: "10vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-slate-700">
          <span className="text-gray-400 text-sm">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search name, mobile, email, company, project… (min 3 chars)"
            className="flex-1 bg-transparent outline-none text-sm py-1 dark:text-slate-100"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={close}
            aria-label="Close search"
            title="Close (Esc)"
            className="-mr-1 inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700 transition"
          >
            <span className="text-lg leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[64vh] overflow-y-auto">
          {query.length < MIN_CHARS && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Type at least 3 characters to search across all modules.</div>
          )}
          {query.length >= MIN_CHARS && loading && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Searching…</div>
          )}
          {query.length >= MIN_CHARS && !loading && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No customer found for “{query}”.</div>
          )}

          {/* Customer results, grouped by module */}
          {[...MODULE_ORDER, ...[...byModule.keys()].filter((k) => !MODULE_ORDER.includes(k as (typeof MODULE_ORDER)[number]))].map((label) => {
            const hits = byModule.get(label) ?? [];
            if (hits.length === 0) return null;
            return (
              <div key={label}>
                <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{label}</div>
                {hits.map((h) => {
                  const idx = cursor++;
                  const isActive = idx === highlight;
                  return (
                    <button
                      key={`${h.recordType}-${h.id}`}
                      type="button"
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => select({ href: h.href, hit: h })}
                      className={`w-full text-left px-4 py-2 ${isActive ? "bg-[#c9a24b]/15" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{h.name}</span>
                        <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${MODULE_BADGE[h.module] ?? "bg-gray-100 text-gray-600"}`}>{h.module}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 truncate">
                        {h.phone && <span className="tabular-nums">📱 {h.phone}</span>}
                        <span className="truncate">👤 {h.agent}</span>
                        <span className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300">{h.status}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          {/* Projects (navigation aid, secondary) */}
          {data.projects.length > 0 && (
            <div>
              <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Projects</div>
              {data.projects.map((p) => {
                const idx = cursor++;
                const isActive = idx === highlight;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => select({ href: "/properties", project: p })}
                    className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 ${isActive ? "bg-[#c9a24b]/15" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                  >
                    <span className="text-sm text-gray-900 dark:text-slate-100 truncate">{p.name}</span>
                    <span className="text-xs text-gray-500 truncate flex-shrink-0">{[p.city, p.country].filter(Boolean).join(", ")}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-200 dark:border-slate-700 text-[10px] text-gray-400 flex items-center justify-between">
          <span>↑↓ navigate · Enter open · module badge shows the source</span>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}

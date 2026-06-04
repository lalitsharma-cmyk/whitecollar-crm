"use client";
// Global quick-search command palette — Ctrl+K (Win/Linux) or Cmd+K (Mac).
// Mounts once at the shell. Listens for the keyboard shortcut, opens a
// centered modal with a search box, debounces queries 200ms, and groups
// results into Leads / Projects / Agents. Arrow keys + Enter to navigate,
// Esc or click-outside to close.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface LeadHit {
  id: string;
  name: string;
  phone: string | null;
  budgetMin: number | null;
  budgetCurrency: string;
}
interface ProjectHit {
  id: string;
  name: string;
  city: string;
  country: string;
}
interface UserHit {
  id: string;
  name: string;
  role: string;
  team: string | null;
}
interface SearchResults {
  leads: LeadHit[];
  projects: ProjectHit[];
  users: UserHit[];
}

interface FlatItem {
  group: "leads" | "projects" | "users";
  href: string;
  label: string;
  meta: string;
}

const EMPTY: SearchResults = { leads: [], projects: [], users: [] };

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return "";
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(0)}K`;
  return `${currency} ${amount}`;
}

export default function QuickSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Flatten grouped results into a single array so arrow-key navigation has
  // a stable index regardless of which group an item lives in.
  const flat: FlatItem[] = useMemo(() => {
    const out: FlatItem[] = [];
    for (const l of results.leads) {
      const bits = [l.phone, formatMoney(l.budgetMin, l.budgetCurrency)].filter(Boolean);
      out.push({ group: "leads", href: `/leads/${l.id}`, label: l.name, meta: bits.join(" · ") });
    }
    for (const p of results.projects) {
      out.push({
        group: "projects",
        // No /properties/[id] route exists — link to the list page.
        href: "/properties",
        label: p.name,
        meta: [p.city, p.country].filter(Boolean).join(", "),
      });
    }
    for (const u of results.users) {
      out.push({
        group: "users",
        href: `/team/${u.id}`,
        label: u.name,
        meta: [u.role, u.team].filter(Boolean).join(" · "),
      });
    }
    return out;
  }, [results]);

  // ── keyboard: global Ctrl/Cmd+K toggles, Esc closes ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isToggle = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
      if (isToggle) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // ── focus input + reset state when opened ──
  useEffect(() => {
    if (open) {
      setQ("");
      setResults(EMPTY);
      setHighlight(0);
      // next tick so the input exists in the DOM
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Reset highlight when result count shrinks so it never points past the end.
  useEffect(() => {
    setHighlight((h) => (h >= flat.length ? 0 : h));
  }, [flat.length]);

  // ── debounced fetch ──
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quick-search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setResults(EMPTY);
        } else {
          const data: SearchResults = await res.json();
          setResults(data);
        }
      } catch {
        // aborted or network error — leave previous results
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const close = useCallback(() => setOpen(false), []);

  const select = useCallback(
    (item: FlatItem | undefined) => {
      if (!item) return;
      close();
      router.push(item.href);
    },
    [close, router]
  );

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : (h + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(flat[highlight]);
    }
  }

  if (!open) return null;

  // Group label rendering — we track a running offset so each row knows its
  // index in the flat list (for highlight + click handling).
  let cursor = 0;
  const groups: Array<{ key: keyof SearchResults; title: string; items: FlatItem[] }> = [
    { key: "leads", title: "Leads", items: flat.filter((i) => i.group === "leads") },
    { key: "projects", title: "Projects", items: flat.filter((i) => i.group === "projects") },
    { key: "users", title: "Agents", items: flat.filter((i) => i.group === "users") },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/50"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
    >
      <div
        className="mx-auto w-[92vw] max-w-2xl bg-white rounded-xl border-2 border-[#c9a24b] shadow-2xl overflow-hidden"
        style={{ marginTop: "12vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200">
          <span className="text-gray-400 text-sm">Search</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Leads, projects, agents… (min 2 chars)"
            className="flex-1 bg-transparent outline-none text-sm py-1"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="text-[10px] text-gray-400 border border-gray-300 rounded px-1.5 py-0.5">
            Esc
          </span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              Type at least 2 characters to search.
            </div>
          )}
          {q.trim().length >= 2 && loading && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Searching…</div>
          )}
          {q.trim().length >= 2 && !loading && flat.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">Not found</div>
          )}

          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.key}>
                <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-widest text-gray-400 font-semibold">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const idx = cursor++;
                  const isActive = idx === highlight;
                  return (
                    <button
                      key={`${item.group}-${item.href}-${idx}`}
                      type="button"
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => select(item)}
                      className={`w-full text-left px-4 py-2 flex items-center justify-between gap-3 ${
                        isActive ? "bg-[#c9a24b]/15" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-sm text-gray-900 truncate">{item.label}</span>
                      {item.meta && (
                        <span className="text-xs text-gray-500 truncate flex-shrink-0">
                          {item.meta}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-200 text-[10px] text-gray-400 flex items-center justify-between">
          <span>↑↓ to navigate · Enter to open</span>
          <span>Ctrl/Cmd + K</span>
        </div>
      </div>
    </div>
  );
}

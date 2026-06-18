"use client";
import Link from "next/link";
import { useState, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export type MDRow = {
  id: string;
  name: string;
  href: string;
  createdDate: string;
  createdTime: string;
  createdAtMs: number;
  budget: string;
  statusLabel: string | null;
  statusClass: string;
  bucket: string;
  bucketClass: string;
  owner: string;
  ownerId: string | null;
  team: string;            // "Dubai" | "India" | "—"
  project: string;
  sourceLabel: string;
  sourceRaw: string;
  leadOrigin: string;
  // read-only preview fields
  phone: string;
  email: string;
  message: string;         // notesShort — what a website lead actually wrote
  lastRemark: string;      // latest activity remark (fallback lead.remarks)
  followupDate: string;    // IST date string, "" if none
};

interface Props {
  rows: MDRow[];
  agents: { id: string; name: string }[];
  statuses: string[];
  isSuperAdmin: boolean;
  viewerId: string;        // per-admin localStorage scope
}

type ColKey =
  | "name" | "agent" | "team"
  | "createdDate" | "createdTime" | "budget" | "project" | "source" | "message" | "status" | "bucket" | "email" | "phone";

const TEAMS = ["Dubai", "India"];
const PAGE = 50;

// Order matters: frozen identity columns first (Name/Agent/Team stay pinned while
// the rest scroll horizontally). Everything after is scrollable + hideable.
const COLS: { key: ColKey; label: string; frozen?: boolean; w?: number; defHidden?: boolean; wide?: boolean }[] = [
  { key: "name", label: "Client Name", frozen: true, w: 170 },
  { key: "agent", label: "Agent", frozen: true, w: 120 },
  { key: "team", label: "Team", frozen: true, w: 72 },
  { key: "createdDate", label: "Created Date" },
  { key: "createdTime", label: "Created Time" },
  { key: "budget", label: "Budget" },
  { key: "project", label: "Project" },
  { key: "source", label: "Source" },
  { key: "message", label: "Message", wide: true },
  { key: "status", label: "Status" },
  { key: "bucket", label: "Bucket" },
  { key: "email", label: "Email", defHidden: true },
  { key: "phone", label: "Phone", defHidden: true },
];
const HIDEABLE = COLS.filter((c) => !c.frozen).map((c) => c.key);
const DEFAULT_HIDDEN = COLS.filter((c) => c.defHidden).map((c) => c.key);

// Frozen-column left offsets (checkbox = 36px, then Name/Agent/Team widths).
const CB_W = 36;
const FROZEN_LEFT: Partial<Record<ColKey, number>> = (() => {
  const out: Partial<Record<ColKey, number>> = {};
  let acc = CB_W;
  for (const c of COLS.filter((c) => c.frozen)) { out[c.key] = acc; acc += c.w ?? 120; }
  return out;
})();

function valueOf(r: MDRow, c: ColKey): string {
  switch (c) {
    case "name": return r.name;
    case "agent": return r.owner;
    case "team": return r.team;
    case "createdDate": return r.createdDate;
    case "createdTime": return r.createdTime;
    case "budget": return r.budget;
    case "project": return r.project;
    case "source": return r.sourceLabel;
    case "message": return r.message;
    case "status": return r.statusLabel ?? "— none —";
    case "bucket": return r.bucket;
    case "email": return r.email;
    case "phone": return r.phone;
  }
}

const todayIST = () => new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

// Unassigned age badge (Orange ≥15m · Red ≥30m · Critical ≥60m). Computed
// client-side from createdAt; only rendered after hydration to avoid a
// server/client time mismatch.
function unassignedAgeBadge(createdAtMs: number): { label: string; cls: string } | null {
  const mins = Math.floor((Date.now() - createdAtMs) / 60000);
  if (mins < 15) return null;
  const age = mins >= 1440 ? `${Math.floor(mins / 1440)}d` : mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
  if (mins >= 60) return { label: `🔴 ${age}`, cls: "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-300" };
  if (mins >= 30) return { label: `🟠 ${age}`, cls: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/40 dark:text-orange-300" };
  return { label: `🟡 ${age}`, cls: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300" };
}

// Default Saved Views — predicate presets over the loaded rows (owner-approved list).
const BUILTINS: { name: string; test: (r: MDRow, today: string) => boolean }[] = [
  { name: "New Website Leads", test: (r) => r.sourceLabel === "Website" },
  { name: "Unassigned Leads", test: (r) => !r.ownerId },
  { name: "Awaiting Classification", test: (r) => r.team === "—" },
  { name: "Dubai Leads", test: (r) => r.team === "Dubai" },
  { name: "India Leads", test: (r) => r.team === "India" },
  { name: "Event Leads", test: (r) => r.sourceLabel === "Event" },
  { name: "Today's Leads", test: (r, t) => r.createdDate === t },
  { name: "Follow Up Today", test: (r, t) => r.followupDate === t },
  { name: "Fresh Leads", test: (r) => r.statusLabel === "Fresh Lead" },
  { name: "Workable Leads", test: (r) => r.bucket === "Workable" },
];

type SavedView = { name: string; filters: Record<string, string[]>; sort: { col: ColKey; dir: "asc" | "desc" } | null; hidden: ColKey[]; frozen: boolean };
const serFilters = (f: Record<string, Set<string>>) => Object.fromEntries(Object.entries(f).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]]));
const deserFilters = (o: Record<string, string[]>) => Object.fromEntries(Object.entries(o || {}).map(([k, a]) => [k, new Set(a)]));

export default function MasterDataRecordsTable({ rows, agents, statuses, isSuperAdmin, viewerId }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [statusTo, setStatusTo] = useState("");
  const [teamTo, setTeamTo] = useState("");
  const [edit, setEdit] = useState<{ id: string; field: ColKey } | null>(null);
  const [editVal, setEditVal] = useState("");
  const [sort, setSort] = useState<{ col: ColKey; dir: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [openFilter, setOpenFilter] = useState<ColKey | null>(null);
  const [fq, setFq] = useState("");
  const [pageNo, setPageNo] = useState(0);
  // new V3.1 state
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set(DEFAULT_HIDDEN));
  const [frozen, setFrozen] = useState(true);
  const [activeView, setActiveView] = useState<string | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [preview, setPreview] = useState<MDRow | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const LSKEY = `wcr_md_v31_${viewerId}`;
  const VKEY = `wcr_md_views_${viewerId}`;

  // ── Sticky state: restore last-used filters / columns / freeze / view per admin ──
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LSKEY) || "null");
      if (s) {
        if (Array.isArray(s.hidden)) setHidden(new Set(s.hidden));
        if (typeof s.frozen === "boolean") setFrozen(s.frozen);
        if (s.sort) setSort(s.sort);
        if (s.filters) setFilters(deserFilters(s.filters));
        if (typeof s.activeView === "string") setActiveView(s.activeView);
      }
      const v = JSON.parse(localStorage.getItem(VKEY) || "null");
      if (Array.isArray(v)) setViews(v);
    } catch { /* ignore corrupt storage */ }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LSKEY, JSON.stringify({ hidden: [...hidden], frozen, sort, filters: serFilters(filters), activeView }));
    } catch { /* quota / private mode — non-fatal */ }
  }, [hidden, frozen, sort, filters, activeView, hydrated, LSKEY]);

  const persistViews = (next: SavedView[]) => { setViews(next); try { localStorage.setItem(VKEY, JSON.stringify(next)); } catch { /**/ } };

  const filtered = useMemo(() => {
    let out = rows;
    const bv = BUILTINS.find((b) => b.name === activeView);
    if (bv) { const t = todayIST(); out = out.filter((r) => bv.test(r, t)); }
    for (const [col, set] of Object.entries(filters)) {
      if (set.size === 0) continue;
      out = out.filter((r) => set.has(valueOf(r, col as ColKey)));
    }
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) =>
        (sort.col === "createdDate" || sort.col === "createdTime")
          ? (a.createdAtMs - b.createdAtMs) * dir
          : valueOf(a, sort.col).localeCompare(valueOf(b, sort.col), undefined, { numeric: true }) * dir,
      );
    }
    return out;
  }, [rows, filters, sort, activeView]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(pageNo, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (pageRows.every((r) => s.has(r.id)) ? new Set() : new Set([...s, ...pageRows.map((r) => r.id)])));
  const clear = () => setSelected(new Set());

  async function bulk(ids: string[], action: string, extra: Record<string, unknown> = {}) {
    if (busy || ids.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/master-data/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ids, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? `Failed (${r.status})`); return; }
      setMsg(`Done — ${j.moved ?? j.assigned ?? j.updated ?? j.deleted ?? j.restored ?? 0} updated.`);
      setEdit(null); router.refresh();
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }
  const runBulk = (action: string, extra: Record<string, unknown> = {}) => bulk([...selected], action, extra).then(() => { if (action !== "restore") clear(); });

  async function saveText(id: string, field: string, value: string) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/leads/${id}/update`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.error ?? `Failed (${r.status})`); return; }
      setEdit(null); router.refresh();
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }

  const distinctVals = (c: ColKey) => Array.from(new Set(rows.map((r) => valueOf(r, c)))).filter((v) => v !== "").sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const btn = "text-xs font-semibold px-2.5 py-1.5 rounded-lg border whitespace-nowrap disabled:opacity-50";
  const openTextEdit = (id: string, field: ColKey, cur: string) => { setEdit({ id, field }); setEditVal(cur === "—" ? "" : cur); };
  const editing = (id: string, f: ColKey) => edit?.id === id && edit?.field === f;
  const openMenu = (id: string, f: ColKey) => setEdit((e) => (e?.id === id && e?.field === f ? null : { id, field: f }));
  const openFilterFor = (c: ColKey) => { setOpenFilter((o) => (o === c ? null : c)); setFq(""); };
  const setColFilter = (c: ColKey, next: Set<string>) => { setFilters((f) => ({ ...f, [c]: next })); setPageNo(0); };

  // ── Views ──
  const applyBuiltin = (name: string) => { setActiveView((a) => (a === name ? null : name)); setPageNo(0); };
  const applyCustom = (v: SavedView) => { setFilters(deserFilters(v.filters)); setSort(v.sort); setHidden(new Set(v.hidden)); setFrozen(v.frozen); setActiveView(v.name); setPageNo(0); };
  const saveCurrentView = () => {
    const name = (window.prompt("Save current filters + columns as a view named:") || "").trim();
    if (!name) return;
    const v: SavedView = { name, filters: serFilters(filters), sort, hidden: [...hidden], frozen };
    persistViews([...views.filter((x) => x.name !== name), v]);
    setActiveView(name);
  };
  const deleteView = (name: string) => { persistViews(views.filter((v) => v.name !== name)); if (activeView === name) setActiveView(null); };
  const resetAll = () => { setFilters({}); setSort(null); setActiveView(null); setPageNo(0); };

  // ── Single-click row → preview drawer · double-click name → rename ──
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowClick = (l: MDRow) => { if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => { setPreview(l); clickTimer.current = null; }, 200); };
  const cancelRowClick = () => { if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; } };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const visibleCols = COLS.filter((c) => c.frozen || !hidden.has(c.key));
  const colSpan = visibleCols.length + 1;
  const fStyle = (key: ColKey): React.CSSProperties | undefined => {
    if (!frozen) return undefined;
    const left = FROZEN_LEFT[key];
    if (left == null) return undefined;
    const w = COLS.find((c) => c.key === key)?.w;
    return { position: "sticky", left, zIndex: 10, minWidth: w, maxWidth: w };
  };
  const fClass = (key: ColKey, sel: boolean) =>
    frozen && FROZEN_LEFT[key] != null ? (sel ? "bg-amber-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900") : "";

  return (
    <div className="space-y-2">
      {/* ── Saved Views + Columns + Freeze toolbar ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setActiveView(null)} className={`${btn} ${!activeView ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300"}`}>All</button>
        {BUILTINS.map((v) => (
          <button key={v.name} onClick={() => applyBuiltin(v.name)} className={`${btn} ${activeView === v.name ? "bg-blue-600 text-white border-blue-600" : "bg-blue-50/60 dark:bg-slate-800 border-blue-200 dark:border-slate-600 text-blue-800 dark:text-blue-300"}`}>{v.name}</button>
        ))}
        {views.map((v) => (
          <span key={v.name} className={`${btn} inline-flex items-center gap-1 ${activeView === v.name ? "bg-violet-600 text-white border-violet-600" : "bg-violet-50 dark:bg-slate-800 border-violet-200 dark:border-slate-600 text-violet-800 dark:text-violet-300"}`}>
            <button onClick={() => applyCustom(v)}>★ {v.name}</button>
            <button onClick={() => deleteView(v.name)} title="Delete view" className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}
        <button onClick={saveCurrentView} className={`${btn} bg-white dark:bg-slate-800 border-dashed border-gray-300 dark:border-slate-600 text-gray-500`}>＋ Save view</button>

        <span className="ml-auto inline-flex items-center gap-1.5">
          <button onClick={() => setFrozen((f) => !f)} className={`${btn} ${frozen ? "bg-sky-50 text-sky-700 border-sky-300" : "bg-white dark:bg-slate-800 text-gray-500 border-gray-200 dark:border-slate-600"}`} title="Freeze Name / Agent / Team while scrolling">❄ Freeze {frozen ? "On" : "Off"}</button>
          <span className="relative">
            <button onClick={() => setColsOpen((o) => !o)} className={`${btn} bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300`}>⚙ Columns</button>
            {colsOpen && (
              <div className="absolute right-0 z-40 mt-1 w-48 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl p-2 text-xs font-normal">
                <div className="font-semibold text-gray-500 mb-1 px-1">Show columns</div>
                {COLS.filter((c) => HIDEABLE.includes(c.key)).map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-1 py-0.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                    <span>{c.label}</span>
                  </label>
                ))}
                <div className="text-[10px] text-gray-400 mt-1 px-1 border-t pt-1 border-gray-100 dark:border-slate-700">Name · Agent · Team stay frozen</div>
              </div>
            )}
          </span>
          {(Object.values(filters).some((s) => s.size) || sort || activeView) && (
            <button onClick={resetAll} className={`${btn} bg-white dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-600`}>✕ Reset</button>
          )}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-30 card p-2.5 flex flex-wrap items-center gap-2 border border-[#c9a24b]/40 bg-amber-50/60 dark:bg-slate-800">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{selected.size} selected</span>
          <span className="inline-flex items-center gap-1">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600"><option value="">Assign to…</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <button disabled={busy || !assignTo} onClick={() => runBulk("assign", { userId: assignTo })} className={`${btn} bg-blue-50 text-blue-800 border-blue-300`}>Assign</button>
          </span>
          <span className="inline-flex items-center gap-1">
            <select value={teamTo} onChange={(e) => setTeamTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600"><option value="">Team…</option>{TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <button disabled={busy || !teamTo} onClick={() => runBulk("change_team", { team: teamTo })} className={`${btn} bg-teal-50 text-teal-800 border-teal-300`}>Change team</button>
          </span>
          <span className="inline-flex items-center gap-1">
            <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600"><option value="">Status…</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <button disabled={busy || !statusTo} onClick={() => runBulk("set_status", { status: statusTo })} className={`${btn} bg-violet-50 text-violet-800 border-violet-300`}>Set</button>
          </span>
          <button disabled={busy} onClick={() => runBulk("move_to_revival")} className={`${btn} bg-sky-50 text-sky-800 border-sky-300`}>→ Revival</button>
          <button disabled={busy} onClick={() => runBulk("move_to_leads")} className={`${btn} bg-emerald-50 text-emerald-800 border-emerald-300`}>→ Leads</button>
          {isSuperAdmin && <button disabled={busy} onClick={() => { if (confirm(`Soft-delete ${selected.size} record(s)? They move to Archived and stay recoverable.`)) runBulk("soft_delete"); }} className={`${btn} bg-red-50 text-red-700 border-red-300`}>Delete</button>}
          <button onClick={clear} className={`${btn} bg-white text-gray-500 border-gray-200 ml-auto`}>Clear</button>
          {msg && <span className="text-xs text-gray-600 dark:text-slate-300 w-full">{msg}</span>}
        </div>
      )}
      {!selected.size && msg && <div className="text-xs text-gray-600 dark:text-slate-300">{msg}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
              <th className="px-3 py-2 w-8 bg-white dark:bg-slate-800" style={frozen ? { position: "sticky", left: 0, zIndex: 20 } : undefined}>
                <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all" />
              </th>
              {visibleCols.map((c) => {
                const active = (filters[c.key]?.size ?? 0) > 0;
                const opts = openFilter === c.key ? distinctVals(c.key) : [];
                const shown = fq ? opts.filter((o) => o.toLowerCase().includes(fq.toLowerCase())) : opts;
                const sel = filters[c.key] ?? new Set<string>();
                const fz = frozen && FROZEN_LEFT[c.key] != null;
                return (
                  <th key={c.key} className={`px-3 py-2 font-semibold relative ${fz ? "bg-white dark:bg-slate-800" : ""}`} style={fz ? { ...fStyle(c.key), zIndex: 20 } : undefined}>
                    <button onClick={() => openFilterFor(c.key)} className="inline-flex items-center gap-1 hover:text-[#0b1a33] dark:hover:text-blue-300">
                      {c.label}
                      <span className={`text-[9px] ${active || sort?.col === c.key ? "text-blue-600" : "text-gray-400"}`}>{sort?.col === c.key ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}</span>
                    </button>
                    {openFilter === c.key && (
                      <div className="absolute z-40 mt-1 left-0 w-56 rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl font-normal normal-case">
                        <div className="flex border-b border-gray-100 dark:border-slate-700">
                          <button onClick={() => { setSort({ col: c.key, dir: "asc" }); setOpenFilter(null); }} className="flex-1 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700">↑ Sort A–Z</button>
                          <button onClick={() => { setSort({ col: c.key, dir: "desc" }); setOpenFilter(null); }} className="flex-1 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 border-l border-gray-100 dark:border-slate-700">↓ Sort Z–A</button>
                        </div>
                        <div className="p-2">
                          <input value={fq} onChange={(e) => setFq(e.target.value)} placeholder="Search…" className="w-full mb-1.5 px-2 py-1 border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700" />
                          <div className="flex justify-between mb-1 text-[10px] text-blue-600">
                            <button onClick={() => setColFilter(c.key, new Set(opts))}>Select all</button>
                            <button onClick={() => setColFilter(c.key, new Set())}>Clear</button>
                          </div>
                          <div className="max-h-44 overflow-auto space-y-0.5">
                            {shown.map((o) => (
                              <label key={o} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                                <input type="checkbox" checked={sel.has(o)} onChange={() => { const n = new Set(sel); n.has(o) ? n.delete(o) : n.add(o); setColFilter(c.key, n); }} className="h-3.5 w-3.5" />
                                <span className="truncate">{o}</span>
                              </label>
                            ))}
                            {shown.length === 0 && <span className="text-gray-400 italic">No values</span>}
                          </div>
                          <button onClick={() => { setOpenFilter(null); setPageNo(0); }} className="mt-2 w-full bg-[#0b1a33] text-white rounded py-1">Apply</button>
                        </div>
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-gray-400">No matching records.</td></tr>}
            {pageRows.map((l) => {
              const sel = selected.has(l.id);
              return (
              <tr key={l.id} onClick={() => rowClick(l)} onDoubleClick={cancelRowClick}
                className={`border-b border-[#f1f5f9] dark:border-slate-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 ${sel ? "bg-amber-50/50 dark:bg-slate-700/40" : ""}`}>
                <td className={`px-3 py-2 ${fClass("name", sel) ? "" : ""}`} style={frozen ? { position: "sticky", left: 0, zIndex: 10 } : undefined} onClick={stop}>
                  <span className={frozen ? (sel ? "bg-amber-50 dark:bg-slate-800" : "bg-white dark:bg-slate-900") : ""}><input type="checkbox" checked={sel} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></span>
                </td>
                {visibleCols.map((c) => {
                  const fz = frozen && FROZEN_LEFT[c.key] != null;
                  const cellCls = `px-3 py-2 relative ${fz ? fClass(c.key, sel) : ""}`;
                  switch (c.key) {
                    case "name":
                      return (
                        <td key={c.key} className={cellCls} style={fStyle(c.key)}>
                          {editing(l.id, "name")
                            ? <span onClick={stop}><InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "name", editVal)} onCancel={() => setEdit(null)} /></span>
                            : <span onDoubleClick={(e) => { stop(e); openTextEdit(l.id, "name", l.name); }} title="Click = preview · double-click = rename" className="font-semibold text-[#0b1a33] dark:text-blue-300 hover:underline">{l.name}</span>}
                        </td>
                      );
                    case "agent": {
                      const ageBadge = hydrated && !l.ownerId ? unassignedAgeBadge(l.createdAtMs) : null;
                      return (
                        <td key={c.key} className={`${cellCls} whitespace-nowrap`} style={fStyle(c.key)} onClick={stop}>
                          <button onClick={() => openMenu(l.id, "agent")} className="text-gray-700 dark:text-slate-300 hover:underline">{l.owner}</button>
                          {ageBadge && <span className={`ml-1.5 align-middle text-[9px] px-1.5 py-0.5 rounded-full border ${ageBadge.cls}`} title="Unassigned for this long — please assign">{ageBadge.label}</span>}
                          {editing(l.id, "agent") && <Menu busy={busy} options={agents.map((a) => ({ value: a.id, label: a.name }))} onPick={(v) => bulk([l.id], "assign", { userId: v })} />}
                        </td>
                      );
                    }
                    case "team":
                      return (
                        <td key={c.key} className={cellCls} style={fStyle(c.key)} onClick={stop}>
                          <button onClick={() => openMenu(l.id, "team")} className="text-gray-700 dark:text-slate-300 hover:underline">{l.team}</button>
                          {editing(l.id, "team") && <Menu busy={busy} options={TEAMS.map((t) => ({ value: t, label: t }))} onPick={(v) => bulk([l.id], "change_team", { team: v })} />}
                        </td>
                      );
                    case "createdDate":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdDate}</td>;
                    case "createdTime":
                      return <td key={c.key} className="px-3 py-2 text-gray-500 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdTime}</td>;
                    case "budget":
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          {editing(l.id, "budget")
                            ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "budgetRaw", editVal)} onCancel={() => setEdit(null)} placeholder="e.g. 5 Cr" />
                            : <button onClick={() => openTextEdit(l.id, "budget", l.budget)} className="text-gray-700 dark:text-slate-300 hover:underline" title="Click to edit">{l.budget}</button>}
                        </td>
                      );
                    case "project":
                      return (
                        <td key={c.key} className="px-3 py-2 relative max-w-[150px]" onClick={stop}>
                          {editing(l.id, "project")
                            ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "sourceDetail", editVal)} onCancel={() => setEdit(null)} />
                            : <button onClick={() => openTextEdit(l.id, "project", l.project)} className="text-gray-600 dark:text-slate-400 hover:underline truncate block max-w-[150px]" title={l.project}>{l.project}</button>}
                        </td>
                      );
                    case "source":
                      return (
                        <td key={c.key} className="px-3 py-2 relative whitespace-nowrap" onClick={stop}>
                          {editing(l.id, "source")
                            ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "sourceRaw", editVal)} onCancel={() => setEdit(null)} />
                            : <button onClick={() => openTextEdit(l.id, "source", l.sourceRaw || l.sourceLabel)} className="text-gray-600 dark:text-slate-400 hover:underline">{l.sourceLabel}</button>}
                        </td>
                      );
                    case "message":
                      return (
                        <td key={c.key} className="px-3 py-2 max-w-[260px]">
                          {l.message
                            ? <span className="text-gray-600 dark:text-slate-400 truncate block max-w-[260px]" title={l.message}>{l.message}</span>
                            : <span className="text-gray-300 dark:text-slate-600">—</span>}
                        </td>
                      );
                    case "status":
                      return (
                        <td key={c.key} className="px-3 py-2 relative" onClick={stop}>
                          <button onClick={() => openMenu(l.id, "status")} title="Click to change status">
                            {l.statusLabel ? <span className={`text-xs px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span> : <span className="text-xs text-gray-400 italic">— set —</span>}
                          </button>
                          {editing(l.id, "status") && <Menu busy={busy} options={statuses.map((s) => ({ value: s, label: s }))} onPick={(v) => bulk([l.id], "set_status", { status: v })} />}
                        </td>
                      );
                    case "bucket":
                      return (
                        <td key={c.key} className="px-3 py-2 relative" onClick={stop}>
                          <button onClick={() => openMenu(l.id, "bucket")}><span className={`text-xs px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span></button>
                          {editing(l.id, "bucket") && <Menu busy={busy} options={[{ value: "move_to_revival", label: "→ Revival (cold)" }, { value: "move_to_leads", label: "→ Active (leads)" }]} onPick={(v) => bulk([l.id], v)} />}
                        </td>
                      );
                    case "email":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 max-w-[180px]"><span className="truncate block max-w-[180px]" title={l.email}>{l.email || "—"}</span></td>;
                    case "phone":
                      return <td key={c.key} className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap tabular-nums">{l.phone || "—"}</td>;
                  }
                })}
              </tr>
            );})}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>{filtered.length} of {rows.length} · single-click = preview · double-click Name / click a cell to edit (admin)</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={safePage === 0} onClick={() => setPageNo(Math.max(0, safePage - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
            <span>Page {safePage + 1} / {totalPages}</span>
            <button disabled={safePage >= totalPages - 1} onClick={() => setPageNo(Math.min(totalPages - 1, safePage + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>

      {preview && <PreviewDrawer l={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function PreviewDrawer({ l, onClose }: { l: MDRow; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const Field = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500">{label}</div>
      <div className={`text-sm text-gray-800 dark:text-slate-200 ${mono ? "tabular-nums" : ""}`}>{value || "—"}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md h-full bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-700 px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-[#0b1a33] dark:text-blue-200">{l.name}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {l.statusLabel && <span className={`text-[11px] px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span>}
              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-xl leading-none">×</button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Field label="Phone" value={l.phone} mono />
          <Field label="Assigned Agent" value={l.owner} />
          <Field label="Email" value={l.email} />
          <Field label="Team" value={l.team} />
          <Field label="Budget" value={l.budget} />
          <Field label="Project" value={l.project} />
          <Field label="Source" value={l.sourceLabel} />
          <Field label="Created" value={`${l.createdDate} · ${l.createdTime}`} />
        </div>
        <div className="px-4 pb-2">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Message (what the client wrote)</div>
          <div className="text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 rounded-lg p-2.5 max-h-44 overflow-y-auto">{l.message || "— no message —"}</div>
        </div>
        <div className="px-4 pb-4">
          <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1">Last Remark</div>
          <div className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap bg-gray-50 dark:bg-slate-800 rounded-lg p-2.5 max-h-40 overflow-y-auto">{l.lastRemark || "— no remarks yet —"}</div>
        </div>
        <div className="px-4 pb-6">
          <Link href={l.href} className="block w-full text-center bg-[#0b1a33] text-white rounded-lg py-2 text-sm font-semibold hover:bg-[#142a4f]">Open full lead →</Link>
        </div>
      </div>
    </div>
  );
}

function Menu({ options, onPick, busy }: { options: { value: string; label: string }[]; onPick: (v: string) => void; busy: boolean }) {
  return (
    <div className="absolute z-30 mt-1 left-0 w-44 max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl text-xs">
      {options.map((o) => (
        <button key={o.value} disabled={busy} onClick={() => onPick(o.value)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">{o.label}</button>
      ))}
    </div>
  );
}

function InlineInput({ value, onChange, onSave, onCancel, placeholder }: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; placeholder?: string }) {
  return (
    <input autoFocus value={value} placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      onBlur={onSave}
      className="w-full min-w-[90px] px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700" />
  );
}

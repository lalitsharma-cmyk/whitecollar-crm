"use client";
import Link from "next/link";
import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import BuyerDistributionPanel from "@/components/BuyerDistributionPanel";

// ── Buyer list = the Leads list experience (Part 5b) ─────────────────────────
// Filters (poolStatus / owner / project / type / nationality / region / repeat /
// search) + sortable columns + Saved Views (localStorage, per-viewer) + two views
// (Admin Pool vs Assigned/All) + an admin bulk toolbar (Assign-from-pool /
// Transfer / Delete / Export / Edit) + the AI distribution console. Buyers aren't
// leads, so this is a dedicated client (no leadFilterWhere); the UX mirrors
// RevivalEngineListClient / MasterDataRecordsTable. Responsive: desktop table,
// mobile cards. 16px inputs on mobile (no iOS zoom).

export type BuyerRow = {
  id: string;
  href: string;
  clientName: string;
  project: string;
  towerUnit: string;
  propertyType: string;
  configuration: string;
  txnValueDisplay: string;
  txnValueNum: number;
  txnDate: string;
  txnDateMs: number;
  nationality: string;
  region: string;        // "India" | "Dubai/UAE" | "—"
  agent: string;
  ownerId: string;
  poolStatus: string;    // ADMIN_POOL | ASSIGNED | CONVERTED | REJECTED
  poolStatusLabel: string;
  attemptCount: number;
  repeat: boolean;
  propertiesOwned: number;
  createdAtMs: number;
  // hidden search fields
  phone: string;
  passport: string;
};

export type BuyerAgent = { id: string; name: string; team: string | null };

interface Props {
  rows: BuyerRow[];
  projects: string[];
  propertyTypes: string[];
  nationalities: string[];
  owners: { id: string; name: string }[];
  agents: BuyerAgent[];
  isAdmin: boolean;
  isAdminOrMgr: boolean;
  viewerId: string;
  poolAvailable: number;
  convertedCount: number;
}

type SortKey = "clientName" | "project" | "txnValue" | "txnDate" | "propertiesOwned" | "poolStatus" | "agent" | "attempts";
type Tab = "all" | "pool" | "assigned" | "converted";
type SavedView = { name: string; tab: Tab; q: string; project: string; ptype: string; nat: string; region: string; ownerId: string; repeatOnly: "" | "yes" | "no"; sortKey: SortKey; sortDir: "asc" | "desc" };

const PAGE = 50;
const EDITABLE_FIELDS: [string, string][] = [
  ["nationality", "Nationality"], ["projectName", "Project"], ["tower", "Tower / Building"],
  ["propertyType", "Property Type"], ["configuration", "Configuration"], ["agentName", "Agent (name)"],
  ["transactionValue", "Transaction Value"], ["remarks", "Remarks"],
];

const statusChip = (s: string) => {
  switch (s) {
    case "ADMIN_POOL": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";
    case "ASSIGNED": return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700";
    case "CONVERTED": return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700";
    case "REJECTED": return "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
    default: return "bg-gray-100 text-gray-600 border-gray-200";
  }
};

export default function BuyerListClient(props: Props) {
  const { rows, projects, propertyTypes, nationalities, owners, agents, isAdmin, isAdminOrMgr, viewerId, poolAvailable, convertedCount } = props;
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [ptype, setPtype] = useState("");
  const [nat, setNat] = useState("");
  const [region, setRegion] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [repeatOnly, setRepeatOnly] = useState<"" | "yes" | "no">("");
  const [sortKey, setSortKey] = useState<SortKey>("txnDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Bulk selection.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState("");
  const [editField, setEditField] = useState("");
  const [editValue, setEditValue] = useState("");
  const [showDistribute, setShowDistribute] = useState(false);

  // Saved views (per viewer, localStorage — mirrors Master Data).
  const VKEY = `wcr_buyer_views_${viewerId}`;
  const [views, setViews] = useState<SavedView[]>([]);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try { const raw = localStorage.getItem(VKEY); if (raw) setViews(JSON.parse(raw)); } catch { /* ignore */ }
    setHydrated(true);
  }, [VKEY]);
  const persistViews = (v: SavedView[]) => { setViews(v); try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch { /* ignore */ } };

  const resetAll = () => { setTab("all"); setQ(""); setProject(""); setPtype(""); setNat(""); setRegion(""); setOwnerId(""); setRepeatOnly(""); setSortKey("txnDate"); setSortDir("desc"); setPage(0); };

  function applyView(v: SavedView) {
    setTab(v.tab); setQ(v.q); setProject(v.project); setPtype(v.ptype); setNat(v.nat); setRegion(v.region);
    setOwnerId(v.ownerId); setRepeatOnly(v.repeatOnly); setSortKey(v.sortKey); setSortDir(v.sortDir); setPage(0);
  }
  function saveCurrentView() {
    const name = window.prompt("Name this view:");
    if (!name || !name.trim()) return;
    const v: SavedView = { name: name.trim(), tab, q, project, ptype, nat, region, ownerId, repeatOnly, sortKey, sortDir };
    persistViews([...views.filter((x) => x.name !== v.name), v]);
  }
  function deleteView(name: string) { persistViews(views.filter((v) => v.name !== name)); }

  // ── filter + sort ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (tab === "pool" && r.poolStatus !== "ADMIN_POOL") return false;
      if (tab === "assigned" && r.poolStatus !== "ASSIGNED") return false;
      if (tab === "converted" && r.poolStatus !== "CONVERTED") return false;
      if (project && r.project !== project) return false;
      if (ptype && r.propertyType !== ptype) return false;
      if (nat && r.nationality !== nat) return false;
      if (region && r.region !== region) return false;
      if (ownerId && r.ownerId !== ownerId) return false;
      if (repeatOnly === "yes" && !r.repeat) return false;
      if (repeatOnly === "no" && r.repeat) return false;
      if (needle) {
        const hay = `${r.clientName} ${r.phone} ${r.passport} ${r.project} ${r.towerUnit} ${r.agent}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    out = out.slice().sort((a, b) => {
      switch (sortKey) {
        case "clientName": return a.clientName.localeCompare(b.clientName) * dir;
        case "project": return a.project.localeCompare(b.project) * dir;
        case "txnValue": return (a.txnValueNum - b.txnValueNum) * dir;
        case "propertiesOwned": return (a.propertiesOwned - b.propertiesOwned) * dir;
        case "poolStatus": return a.poolStatus.localeCompare(b.poolStatus) * dir;
        case "agent": return a.agent.localeCompare(b.agent) * dir;
        case "attempts": return (a.attemptCount - b.attemptCount) * dir;
        case "txnDate":
        default: return (a.txnDateMs - b.txnDateMs) * dir;
      }
    });
    return out;
  }, [rows, tab, q, project, ptype, nat, region, ownerId, repeatOnly, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  // Selection helpers (operate on the FILTERED set, not just the page).
  const filteredIds = useMemo(() => filtered.map((r) => r.id), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  };
  const toggleOne = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearSel = () => setSelected(new Set());

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "clientName" || k === "project" || k === "agent" ? "asc" : "desc"); }
    setPage(0);
  };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const sel = "border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100";
  const anyFilter = q || project || ptype || nat || region || ownerId || repeatOnly || tab !== "all";

  // ── bulk runner ──────────────────────────────────────────────────────────
  async function runBulk(action: string, extra?: Record<string, unknown>, confirmMsg?: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) { setBulkMsg("Select at least one buyer first."); return; }
    if (confirmMsg && !window.confirm(confirmMsg.replace("{n}", String(ids.length)))) return;
    setBulkBusy(true); setBulkMsg(null);
    try {
      const r = await fetch("/api/buyer-data/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, buyerIds: ids, ...extra }),
      });
      const j = await r.json();
      if (!r.ok) { setBulkMsg(`⚠ ${j.error ?? "Bulk action failed."}`); setBulkBusy(false); return; }
      const n = j.transferred ?? j.deleted ?? j.restored ?? j.updated ?? 0;
      setBulkMsg(`✓ ${action}: ${n} buyer${n === 1 ? "" : "s"}.`);
      clearSel(); setTransferTo(""); setEditField(""); setEditValue("");
      router.refresh();
    } catch { setBulkMsg("⚠ Network error."); }
    finally { setBulkBusy(false); }
  }

  // Export the current filtered selection (or all) via the CSV route. For a
  // project filter we can hand it to the existing ?project= path; otherwise we
  // export everything (admin) — the route is admin-only + watermarked.
  function exportCsv() {
    const url = project ? `/api/buyer-data/export?project=${encodeURIComponent(project)}` : `/api/buyer-data/export`;
    window.location.href = url;
  }

  const tabBtn = (t: Tab, label: string, count?: number) => (
    <button type="button" onClick={() => { setTab(t); setPage(0); clearSel(); }}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t ? "bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33]" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300"}`}>
      {label}{count != null ? ` (${count})` : ""}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* ── Views (tabs) + Saved views + filters toggle ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {tabBtn("all", "All")}
        {isAdmin && tabBtn("pool", "Admin Pool", poolAvailable)}
        {tabBtn("assigned", "Assigned")}
        {isAdmin && tabBtn("converted", "Converted", convertedCount)}
        <div className="ml-auto flex items-center gap-2">
          {isAdmin && (
            <button type="button" onClick={() => setShowDistribute((s) => !s)}
              className="btn btn-ghost text-sm" title="AI buyer distribution — assign pool buyers to agents">
              ✨ Distribute
            </button>
          )}
          <button type="button" onClick={() => setShowFilters((s) => !s)} className={`btn text-sm ${anyFilter ? "btn-primary" : "btn-ghost"}`}>
            ⚙ Filters{anyFilter ? " •" : ""}
          </button>
        </div>
      </div>

      {/* Saved views bar */}
      {hydrated && (views.length > 0 || anyFilter) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {views.map((v) => (
            <span key={v.name} className="group inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 pl-2.5 pr-1 py-0.5 text-xs">
              <button type="button" onClick={() => applyView(v)} className="text-amber-800 dark:text-amber-300 font-medium">{v.name}</button>
              <button type="button" onClick={() => deleteView(v.name)} className="text-amber-400 hover:text-red-500" aria-label={`Delete view ${v.name}`}>✕</button>
            </span>
          ))}
          {anyFilter && <button type="button" onClick={saveCurrentView} className="text-xs text-[#0b1a33] dark:text-blue-300 underline">+ Save view</button>}
        </div>
      )}

      {/* AI distribution console (admin) */}
      {isAdmin && showDistribute && (
        <BuyerDistributionPanel agents={agents} poolAvailable={poolAvailable} onApplied={() => router.refresh()} />
      )}

      {/* ── Filter panel ───────────────────────────────────────────────────── */}
      {showFilters && (
        <div className="card p-3 flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, phone, passport, unit, agent…" className={`${sel} flex-1 min-w-[200px]`} />
          <select value={project} onChange={(e) => { setProject(e.target.value); setPage(0); }} className={sel} title="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={ptype} onChange={(e) => { setPtype(e.target.value); setPage(0); }} className={sel} title="Property type">
            <option value="">All types</option>
            {propertyTypes.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={nat} onChange={(e) => { setNat(e.target.value); setPage(0); }} className={sel} title="Nationality">
            <option value="">All nationalities</option>
            {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select value={region} onChange={(e) => { setRegion(e.target.value); setPage(0); }} className={sel} title="Region / market">
            <option value="">All regions</option>
            <option value="India">India</option>
            <option value="Dubai/UAE">Dubai / UAE</option>
          </select>
          {(isAdminOrMgr && owners.length > 0) && (
            <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPage(0); }} className={sel} title="Owner agent">
              <option value="">All owners</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select value={repeatOnly} onChange={(e) => { setRepeatOnly(e.target.value as "" | "yes" | "no"); setPage(0); }} className={sel} title="Repeat buyers">
            <option value="">All buyers</option>
            <option value="yes">🔁 Repeat buyers</option>
            <option value="no">First-time buyers</option>
          </select>
          {anyFilter && <button type="button" onClick={resetAll} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Clear all</button>}
        </div>
      )}

      {/* ── Bulk toolbar (admin/mgr) ───────────────────────────────────────── */}
      {isAdminOrMgr && selected.size > 0 && (
        <div className="card p-3 bg-amber-50/60 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">{selected.size} selected</span>
          {/* Transfer */}
          <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className={sel} title="Transfer to agent">
            <option value="">Transfer to…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.team ? ` · ${a.team}` : ""}</option>)}
          </select>
          <button type="button" disabled={!transferTo || bulkBusy} onClick={() => runBulk("transfer", { agentId: transferTo })}
            className="btn btn-primary text-sm disabled:opacity-40">Transfer</button>
          {/* Edit */}
          <select value={editField} onChange={(e) => setEditField(e.target.value)} className={sel} title="Bulk edit field">
            <option value="">Edit field…</option>
            {EDITABLE_FIELDS.map(([f, l]) => <option key={f} value={f}>{l}</option>)}
          </select>
          {editField && (
            <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="New value" className={`${sel} w-36`} />
          )}
          {editField && (
            <button type="button" disabled={bulkBusy} onClick={() => runBulk("edit", { field: editField, value: editValue }, "Set this field on {n} buyers?")}
              className="btn btn-ghost text-sm disabled:opacity-40">Apply edit</button>
          )}
          {/* Export */}
          <button type="button" disabled={bulkBusy} onClick={exportCsv} className="btn btn-ghost text-sm" title="Export to CSV">⬇ Export</button>
          {/* Delete (admin only) */}
          {isAdmin && (
            <button type="button" disabled={bulkBusy} onClick={() => runBulk("delete", {}, "Move {n} buyer(s) to the recycle bin? This is reversible.")}
              className="btn text-sm text-red-600 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 disabled:opacity-40">🗑 Delete</button>
          )}
          <button type="button" onClick={clearSel} className="text-xs text-gray-500 underline ml-1">Clear selection</button>
        </div>
      )}
      {bulkMsg && <div className="text-xs px-3 py-1.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200">{bulkMsg}</div>}

      {/* ── Count ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>{filtered.length} record{filtered.length === 1 ? "" : "s"}{anyFilter ? " (filtered)" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
          {rows.length === 0 ? "No buyer records yet. Use Import to bring in transaction data." : "No records match these filters."}
        </div>
      ) : (
        <>
          {/* ── Desktop table ───────────────────────────────────────────────── */}
          <div className="card p-0 overflow-x-auto hidden lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  {isAdminOrMgr && (
                    <th className="px-3 py-2 w-8"><input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} aria-label="Select all" /></th>
                  )}
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("clientName")}>Client Name{arrow("clientName")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("poolStatus")}>Status{arrow("poolStatus")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("project")}>Project{arrow("project")}</th>
                  <th className="px-3 py-2 whitespace-nowrap">Tower / Unit</th>
                  <th className="px-3 py-2 whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap text-right" onClick={() => toggleSort("txnValue")}>Txn Value{arrow("txnValue")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("txnDate")}>Txn Date{arrow("txnDate")}</th>
                  <th className="px-3 py-2 whitespace-nowrap">Nationality</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("agent")}>Agent{arrow("agent")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap text-center" onClick={() => toggleSort("attempts")} title="Contact attempts (auto-return at 5)">Att{arrow("attempts")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap text-center" onClick={() => toggleSort("propertiesOwned")} title="Properties owned by this buyer">Buyer{arrow("propertiesOwned")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageRows.map((r) => (
                  <tr key={r.id} className={`hover:bg-gray-50 dark:hover:bg-slate-800/50 ${selected.has(r.id) ? "bg-amber-50/50 dark:bg-amber-900/10" : ""}`}>
                    {isAdminOrMgr && (
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.clientName}`} /></td>
                    )}
                    <td className="px-3 py-2"><Link href={r.href} className="font-medium text-[#0b1a33] dark:text-blue-300 hover:underline">{r.clientName}</Link></td>
                    <td className="px-3 py-2"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChip(r.poolStatus)}`}>{r.poolStatusLabel}</span></td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{r.project || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.towerUnit || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.propertyType || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.txnValueDisplay}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.txnDate || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.nationality || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.agent || <span className="text-blue-500 text-xs">— pool —</span>}</td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {r.poolStatus === "ASSIGNED" && r.attemptCount > 0
                        ? <span className={r.attemptCount >= 4 ? "text-red-600 font-semibold" : r.attemptCount >= 3 ? "text-amber-600" : "text-gray-500"}>{r.attemptCount}/5</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {r.repeat
                        ? <span title={`Repeat buyer — owns ${r.propertiesOwned} properties`} className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">🔁 {r.propertiesOwned}</span>
                        : <span className="text-[11px] text-gray-400">1</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ────────────────────────────────────────────────── */}
          <div className="lg:hidden space-y-2">
            {pageRows.map((r) => (
              <div key={r.id} className={`card p-3 ${selected.has(r.id) ? "ring-1 ring-amber-300" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    {isAdminOrMgr && <input type="checkbox" className="mt-1" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.clientName}`} />}
                    <Link href={r.href} className="min-w-0">
                      <div className="font-semibold text-[#0b1a33] dark:text-blue-300 truncate">{r.clientName}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{r.project || "—"}{r.towerUnit ? ` · ${r.towerUnit}` : ""}</div>
                    </Link>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChip(r.poolStatus)}`}>{r.poolStatusLabel}</span>
                    {r.repeat && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">🔁 {r.propertiesOwned}</span>}
                  </div>
                </div>
                <Link href={r.href} className="block mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
                  <div><span className="text-gray-400">Value:</span> <span className="font-medium text-gray-800 dark:text-slate-200">{r.txnValueDisplay}</span></div>
                  <div><span className="text-gray-400">Date:</span> {r.txnDate || "—"}</div>
                  <div><span className="text-gray-400">Type:</span> {r.propertyType || "—"}</div>
                  <div><span className="text-gray-400">Nationality:</span> {r.nationality || "—"}</div>
                  <div><span className="text-gray-400">Agent:</span> {r.agent || "pool"}</div>
                  {r.poolStatus === "ASSIGNED" && r.attemptCount > 0 && <div><span className="text-gray-400">Attempts:</span> {r.attemptCount}/5</div>}
                </Link>
              </div>
            ))}
          </div>

          {/* ── Pagination ──────────────────────────────────────────────────── */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
              <span className="text-gray-500 dark:text-slate-400">Page {safePage + 1} of {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

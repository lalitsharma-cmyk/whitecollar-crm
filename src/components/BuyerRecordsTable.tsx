"use client";
import Link from "next/link";
import { useState, useMemo } from "react";

// Excel-style records grid for the Buyer Data module. ADMIN-only data (the page
// gates it); this is the presentation layer. Responsive: a real table on
// desktop (lg+), stacked cards on mobile. Client-side filter / search / sort /
// paginate over a server-capped row set, mirroring the Master Data UX without
// its column-hiding machinery (the buyer columns are few + always relevant).

export type BuyerRow = {
  id: string;
  href: string;
  clientName: string;
  project: string;
  towerUnit: string;        // "Tower · Unit" combined for the cell
  propertyType: string;
  configuration: string;
  txnValueDisplay: string;  // pre-formatted compact value ("4 Cr", "1.5M AED", "—")
  txnValueNum: number;      // raw, for sorting
  txnDate: string;          // IST date string ("" if none)
  txnDateMs: number;        // for sorting
  nationality: string;
  agent: string;
  repeat: boolean;          // repeat-buyer (owns >1 property)
  propertiesOwned: number;  // rollup count for this buyer
  // hidden search fields
  phone: string;
  passport: string;
};

interface Props {
  rows: BuyerRow[];
  projects: string[];
  propertyTypes: string[];
  nationalities: string[];
}

type SortKey = "clientName" | "project" | "txnValue" | "txnDate" | "propertiesOwned";
const PAGE = 50;

export default function BuyerRecordsTable({ rows, projects, propertyTypes, nationalities }: Props) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [ptype, setPtype] = useState("");
  const [nat, setNat] = useState("");
  const [repeatOnly, setRepeatOnly] = useState<"" | "yes" | "no">("");
  const [sortKey, setSortKey] = useState<SortKey>("txnDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (project && r.project !== project) return false;
      if (ptype && r.propertyType !== ptype) return false;
      if (nat && r.nationality !== nat) return false;
      if (repeatOnly === "yes" && !r.repeat) return false;
      if (repeatOnly === "no" && r.repeat) return false;
      if (needle) {
        const hay = `${r.clientName} ${r.phone} ${r.passport} ${r.project} ${r.towerUnit}`.toLowerCase();
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
        case "txnDate":
        default: return (a.txnDateMs - b.txnDateMs) * dir;
      }
    });
    return out;
  }, [rows, q, project, ptype, nat, repeatOnly, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE, safePage * PAGE + PAGE);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "clientName" || k === "project" ? "asc" : "desc"); }
    setPage(0);
  };
  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const sel = "border border-gray-200 dark:border-slate-600 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:text-slate-100";
  const resetAll = () => { setQ(""); setProject(""); setPtype(""); setNat(""); setRepeatOnly(""); setPage(0); };
  const anyFilter = q || project || ptype || nat || repeatOnly;

  return (
    <div className="space-y-3">
      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder="Search name, phone, passport, unit…"
          className={`${sel} flex-1 min-w-[200px]`}
        />
        <select value={project} onChange={(e) => { setProject(e.target.value); setPage(0); }} className={sel} title="Filter by project">
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={ptype} onChange={(e) => { setPtype(e.target.value); setPage(0); }} className={sel} title="Filter by property type">
          <option value="">All types</option>
          {propertyTypes.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={nat} onChange={(e) => { setNat(e.target.value); setPage(0); }} className={sel} title="Filter by nationality">
          <option value="">All nationalities</option>
          {nationalities.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={repeatOnly} onChange={(e) => { setRepeatOnly(e.target.value as "" | "yes" | "no"); setPage(0); }} className={sel} title="Repeat buyers only">
          <option value="">All buyers</option>
          <option value="yes">🔁 Repeat buyers</option>
          <option value="no">First-time buyers</option>
        </select>
        {anyFilter && <button type="button" onClick={resetAll} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200 underline">Clear</button>}
        <span className="text-xs text-gray-500 dark:text-slate-400 ml-auto">{filtered.length} record{filtered.length === 1 ? "" : "s"}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
          {rows.length === 0 ? "No buyer records yet. Use Import to bring in transaction data." : "No records match these filters."}
        </div>
      ) : (
        <>
          {/* ── Desktop table ───────────────────────────────────────────── */}
          <div className="card p-0 overflow-x-auto hidden lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("clientName")}>Client Name{arrow("clientName")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("project")}>Project{arrow("project")}</th>
                  <th className="px-3 py-2 whitespace-nowrap">Tower / Unit</th>
                  <th className="px-3 py-2 whitespace-nowrap">Type</th>
                  <th className="px-3 py-2 whitespace-nowrap">Config</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap text-right" onClick={() => toggleSort("txnValue")}>Txn Value{arrow("txnValue")}</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap" onClick={() => toggleSort("txnDate")}>Txn Date{arrow("txnDate")}</th>
                  <th className="px-3 py-2 whitespace-nowrap">Nationality</th>
                  <th className="px-3 py-2 whitespace-nowrap">Agent</th>
                  <th className="px-3 py-2 cursor-pointer whitespace-nowrap text-center" onClick={() => toggleSort("propertiesOwned")} title="Properties owned by this buyer">Buyer{arrow("propertiesOwned")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageRows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-3 py-2">
                      <Link href={r.href} className="font-medium text-[#0b1a33] dark:text-blue-300 hover:underline">{r.clientName}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{r.project || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.towerUnit || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.propertyType || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.configuration || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{r.txnValueDisplay}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.txnDate || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.nationality || "—"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{r.agent || "—"}</td>
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

          {/* ── Mobile cards ────────────────────────────────────────────── */}
          <div className="lg:hidden space-y-2">
            {pageRows.map((r) => (
              <Link key={r.id} href={r.href} className="card p-3 block active:bg-gray-50 dark:active:bg-slate-800/50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#0b1a33] dark:text-blue-300 truncate">{r.clientName}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{r.project || "—"}{r.towerUnit ? ` · ${r.towerUnit}` : ""}</div>
                  </div>
                  {r.repeat && <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">🔁 {r.propertiesOwned}</span>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-slate-400">
                  <div><span className="text-gray-400">Value:</span> <span className="font-medium text-gray-800 dark:text-slate-200">{r.txnValueDisplay}</span></div>
                  <div><span className="text-gray-400">Date:</span> {r.txnDate || "—"}</div>
                  <div><span className="text-gray-400">Type:</span> {r.propertyType || "—"}</div>
                  <div><span className="text-gray-400">Config:</span> {r.configuration || "—"}</div>
                  <div><span className="text-gray-400">Nationality:</span> {r.nationality || "—"}</div>
                  <div><span className="text-gray-400">Agent:</span> {r.agent || "—"}</div>
                </div>
              </Link>
            ))}
          </div>

          {/* ── Pagination ──────────────────────────────────────────────── */}
          {pageCount > 1 && (
            <div className="flex items-center justify-between text-sm">
              <button type="button" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="btn btn-ghost disabled:opacity-40">← Prev</button>
              <span className="text-gray-500 dark:text-slate-400">Page {safePage + 1} of {pageCount}</span>
              <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                className="btn btn-ghost disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState, useMemo } from "react";
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
};

interface Props {
  rows: MDRow[];
  agents: { id: string; name: string }[];
  statuses: string[];
  isSuperAdmin: boolean;
}

type ColKey = "createdDate" | "createdTime" | "name" | "budget" | "agent" | "team" | "project" | "source" | "status" | "bucket";
const TEAMS = ["Dubai", "India"];
const PAGE = 50;
const COLS: { key: ColKey; label: string; cls?: string }[] = [
  { key: "createdDate", label: "Created Date" },
  { key: "createdTime", label: "Created Time" },
  { key: "name", label: "Client Name" },
  { key: "budget", label: "Budget" },
  { key: "agent", label: "Agent" },
  { key: "team", label: "Team", cls: "hidden sm:table-cell" },
  { key: "project", label: "Project", cls: "hidden md:table-cell" },
  { key: "source", label: "Source", cls: "hidden md:table-cell" },
  { key: "status", label: "Status" },
  { key: "bucket", label: "Bucket", cls: "hidden sm:table-cell" },
];

function valueOf(r: MDRow, c: ColKey): string {
  switch (c) {
    case "createdDate": return r.createdDate;
    case "createdTime": return r.createdTime;
    case "name": return r.name;
    case "budget": return r.budget;
    case "agent": return r.owner;
    case "team": return r.team;
    case "project": return r.project;
    case "source": return r.sourceLabel;
    case "status": return r.statusLabel ?? "— none —";
    case "bucket": return r.bucket;
  }
}

export default function MasterDataRecordsTable({ rows, agents, statuses, isSuperAdmin }: Props) {
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
  const [fq, setFq] = useState("");                 // filter-popover search (parent-held → no focus loss)
  const [pageNo, setPageNo] = useState(0);

  const filtered = useMemo(() => {
    let out = rows;
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
  }, [rows, filters, sort]);

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

  const distinctVals = (c: ColKey) => Array.from(new Set(rows.map((r) => valueOf(r, c)))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const btn = "text-xs font-semibold px-2.5 py-1.5 rounded-lg border whitespace-nowrap disabled:opacity-50";
  const openTextEdit = (id: string, field: ColKey, cur: string) => { setEdit({ id, field }); setEditVal(cur === "—" ? "" : cur); };
  const editing = (id: string, f: ColKey) => edit?.id === id && edit?.field === f;
  const openMenu = (id: string, f: ColKey) => setEdit((e) => (e?.id === id && e?.field === f ? null : { id, field: f }));
  const openFilterFor = (c: ColKey) => { setOpenFilter((o) => (o === c ? null : c)); setFq(""); };
  const setColFilter = (c: ColKey, next: Set<string>) => setFilters((f) => ({ ...f, [c]: next }));

  return (
    <div className="space-y-2">
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
              <th className="px-3 py-2 w-8"><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all" /></th>
              {COLS.map((c) => {
                const active = (filters[c.key]?.size ?? 0) > 0;
                const opts = openFilter === c.key ? distinctVals(c.key) : [];
                const shown = fq ? opts.filter((o) => o.toLowerCase().includes(fq.toLowerCase())) : opts;
                const sel = filters[c.key] ?? new Set<string>();
                return (
                  <th key={c.key} className={`px-3 py-2 font-semibold relative ${c.cls ?? ""}`}>
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
                            {shown.length === 0 && <span className="text-gray-400 italic">No match</span>}
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
            {pageRows.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">No matching records.</td></tr>}
            {pageRows.map((l) => (
              <tr key={l.id} className={`border-b border-[#f1f5f9] dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 ${selected.has(l.id) ? "bg-amber-50/50 dark:bg-slate-700/40" : ""}`}>
                <td className="px-3 py-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdDate}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 whitespace-nowrap text-xs tabular-nums">{l.createdTime}</td>
                <td className="px-3 py-2 relative">
                  {editing(l.id, "name")
                    ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "name", editVal)} onCancel={() => setEdit(null)} />
                    : <span onDoubleClick={() => openTextEdit(l.id, "name", l.name)} title="Double-click to rename"><Link href={l.href} className="font-semibold text-[#0b1a33] dark:text-blue-300 hover:underline">{l.name}</Link></span>}
                </td>
                <td className="px-3 py-2 relative whitespace-nowrap">
                  {editing(l.id, "budget")
                    ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "budgetRaw", editVal)} onCancel={() => setEdit(null)} placeholder="e.g. 5 Cr" />
                    : <button onClick={() => openTextEdit(l.id, "budget", l.budget)} className="text-gray-700 dark:text-slate-300 hover:underline" title="Click to edit">{l.budget}</button>}
                </td>
                <td className="px-3 py-2 relative whitespace-nowrap">
                  <button onClick={() => openMenu(l.id, "agent")} className="text-gray-700 dark:text-slate-300 hover:underline">{l.owner}</button>
                  {editing(l.id, "agent") && <Menu busy={busy} options={agents.map((a) => ({ value: a.id, label: a.name }))} onPick={(v) => bulk([l.id], "assign", { userId: v })} />}
                </td>
                <td className="px-3 py-2 relative hidden sm:table-cell">
                  <button onClick={() => openMenu(l.id, "team")} className="text-gray-700 dark:text-slate-300 hover:underline">{l.team}</button>
                  {editing(l.id, "team") && <Menu busy={busy} options={TEAMS.map((t) => ({ value: t, label: t }))} onPick={(v) => bulk([l.id], "change_team", { team: v })} />}
                </td>
                <td className="px-3 py-2 relative hidden md:table-cell max-w-[150px]">
                  {editing(l.id, "project")
                    ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "sourceDetail", editVal)} onCancel={() => setEdit(null)} />
                    : <button onClick={() => openTextEdit(l.id, "project", l.project)} className="text-gray-600 dark:text-slate-400 hover:underline truncate block max-w-[150px]" title={l.project}>{l.project}</button>}
                </td>
                <td className="px-3 py-2 relative hidden md:table-cell whitespace-nowrap">
                  {editing(l.id, "source")
                    ? <InlineInput value={editVal} onChange={setEditVal} onSave={() => saveText(l.id, "sourceRaw", editVal)} onCancel={() => setEdit(null)} />
                    : <button onClick={() => openTextEdit(l.id, "source", l.sourceRaw || l.sourceLabel)} className="text-gray-600 dark:text-slate-400 hover:underline">{l.sourceLabel}</button>}
                </td>
                <td className="px-3 py-2 relative">
                  <button onClick={() => openMenu(l.id, "status")} title="Click to change status">
                    {l.statusLabel ? <span className={`text-xs px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span> : <span className="text-xs text-gray-400 italic">— set —</span>}
                  </button>
                  {editing(l.id, "status") && <Menu busy={busy} options={statuses.map((s) => ({ value: s, label: s }))} onPick={(v) => bulk([l.id], "set_status", { status: v })} />}
                </td>
                <td className="px-3 py-2 relative hidden sm:table-cell">
                  <button onClick={() => openMenu(l.id, "bucket")}><span className={`text-xs px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span></button>
                  {editing(l.id, "bucket") && <Menu busy={busy} options={[{ value: "move_to_revival", label: "→ Revival (cold)" }, { value: "move_to_leads", label: "→ Active (leads)" }]} onPick={(v) => bulk([l.id], v)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>{filtered.length} of {rows.length} · double-click Name / click a cell to edit (admin)</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={safePage === 0} onClick={() => setPageNo(Math.max(0, safePage - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
            <span>Page {safePage + 1} / {totalPages}</span>
            <button disabled={safePage >= totalPages - 1} onClick={() => setPageNo(Math.min(totalPages - 1, safePage + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
          </div>
        )}
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
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
      onBlur={onSave}
      className="w-full min-w-[90px] px-2 py-1 text-sm border border-blue-400 rounded dark:bg-slate-700" />
  );
}

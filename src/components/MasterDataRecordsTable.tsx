"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type MDRow = {
  id: string;
  name: string;
  href: string;
  statusLabel: string | null;
  statusClass: string;
  bucket: string;
  bucketClass: string;
  owner: string;
  ownerId: string | null;
  team: string;            // "Dubai" | "India" | "—"
  project: string;
  sourceLabel: string;
  createdLabel: string;    // date + time (IST)
  importFile: string;
};

interface Props {
  rows: MDRow[];
  agents: { id: string; name: string }[];
  statuses: string[];
  isSuperAdmin: boolean;
}

export default function MasterDataRecordsTable({ rows, agents, statuses, isSuperAdmin }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [statusTo, setStatusTo] = useState("");
  const [teamTo, setTeamTo] = useState("");
  // Inline editor open for a given { rowId, field }
  const [edit, setEdit] = useState<{ id: string; field: "status" | "team" | "agent" } | null>(null);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (rows.every((r) => s.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))));
  const clear = () => setSelected(new Set());

  // Single endpoint for both bulk (selected ids) and inline single-row edits.
  async function mutate(ids: string[], action: string, extra: Record<string, unknown> = {}) {
    if (busy || ids.length === 0) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/master-data/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ids, ...extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? `Failed (${r.status})`); return; }
      const n = j.moved ?? j.assigned ?? j.updated ?? j.deleted ?? j.restored ?? 0;
      setMsg(`Done — ${n} record(s) updated.`);
      setEdit(null);
      router.refresh();
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); }
    finally { setBusy(false); }
  }
  const runBulk = (action: string, extra: Record<string, unknown> = {}) => mutate([...selected], action, extra).then(() => { if (action !== "restore") clear(); });

  function exportSelected() {
    const picked = rows.filter((r) => selected.has(r.id));
    if (picked.length === 0) return;
    const head = ["Created", "Name", "Status", "Bucket", "Agent", "Team", "Project", "Source", "Import"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(",")]
      .concat(picked.map((r) => [r.createdLabel, r.name, r.statusLabel ?? "", r.bucket, r.owner, r.team, r.project, r.sourceLabel, r.importFile].map(esc).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `master-data-selected-${picked.length}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const btn = "text-xs font-semibold px-2.5 py-1.5 rounded-lg border whitespace-nowrap disabled:opacity-50";
  const teams = ["Dubai", "India"];

  // A small click-to-edit cell. `display` is the read view; `options` open a menu.
  function EditMenu({ rowId, field, options, onPick }: { rowId: string; field: "status" | "team" | "agent"; options: { value: string; label: string }[]; onPick: (v: string) => void }) {
    return (
      <div className="absolute z-30 mt-1 left-0 w-44 max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl text-xs">
        {options.map((o) => (
          <button key={o.value} disabled={busy} onClick={() => onPick(o.value)}
            className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
            {o.label}
          </button>
        ))}
        {field === "agent" && <button onClick={() => setEdit(null)} className="block w-full text-left px-3 py-1.5 text-gray-400 border-t border-gray-100 dark:border-slate-700">Cancel</button>}
      </div>
    );
  }
  const editable = (id: string, field: "status" | "team" | "agent") => edit?.id === id && edit?.field === field;
  const openEdit = (id: string, field: "status" | "team" | "agent") => setEdit((e) => (e?.id === id && e?.field === field ? null : { id, field }));

  return (
    <div className="space-y-2">
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-20 card p-2.5 flex flex-wrap items-center gap-2 border border-[#c9a24b]/40 bg-amber-50/60 dark:bg-slate-800">
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">{selected.size} selected</span>
          <button disabled={busy} onClick={() => runBulk("move_to_leads")} className={`${btn} bg-emerald-50 text-emerald-800 border-emerald-300`}>→ Move to Leads</button>
          <button disabled={busy} onClick={() => runBulk("move_to_revival")} className={`${btn} bg-sky-50 text-sky-800 border-sky-300`}>→ Move to Revival</button>
          <span className="inline-flex items-center gap-1">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600">
              <option value="">Assign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button disabled={busy || !assignTo} onClick={() => runBulk("assign", { userId: assignTo })} className={`${btn} bg-blue-50 text-blue-800 border-blue-300`}>Assign</button>
          </span>
          <span className="inline-flex items-center gap-1">
            <select value={statusTo} onChange={(e) => setStatusTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600">
              <option value="">Set status…</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button disabled={busy || !statusTo} onClick={() => runBulk("set_status", { status: statusTo })} className={`${btn} bg-violet-50 text-violet-800 border-violet-300`}>Set</button>
          </span>
          <span className="inline-flex items-center gap-1">
            <select value={teamTo} onChange={(e) => setTeamTo(e.target.value)} className="text-xs border rounded-lg px-2 py-1.5 dark:bg-slate-800 dark:border-slate-600">
              <option value="">Team…</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button disabled={busy || !teamTo} onClick={() => runBulk("change_team", { team: teamTo })} className={`${btn} bg-teal-50 text-teal-800 border-teal-300`}>Change team</button>
          </span>
          <button disabled={busy} onClick={exportSelected} className={`${btn} bg-white text-gray-700 border-gray-300`}>⤓ Export</button>
          <button disabled={busy} onClick={() => runBulk("restore")} className={`${btn} bg-white text-gray-700 border-gray-300`}>Restore</button>
          {isSuperAdmin && (
            <button disabled={busy} onClick={() => { if (confirm(`Soft-delete ${selected.size} record(s)? They move to Archived and stay recoverable.`)) runBulk("soft_delete"); }} className={`${btn} bg-red-50 text-red-700 border-red-300`}>Delete</button>
          )}
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
              <th className="px-3 py-2 font-semibold whitespace-nowrap">Created</th>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Bucket</th>
              <th className="px-3 py-2 font-semibold">Agent</th>
              <th className="px-3 py-2 font-semibold hidden sm:table-cell">Team</th>
              <th className="px-3 py-2 font-semibold hidden md:table-cell">Project</th>
              <th className="px-3 py-2 font-semibold hidden md:table-cell">Source</th>
              <th className="px-3 py-2 font-semibold hidden lg:table-cell">Import</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No records in this category.</td></tr>
            )}
            {rows.map((l) => (
              <tr key={l.id} className={`border-b border-[#f1f5f9] dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 ${selected.has(l.id) ? "bg-amber-50/50 dark:bg-slate-700/40" : ""}`}>
                <td className="px-3 py-2"><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Select ${l.name}`} /></td>
                <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap tabular-nums text-xs">{l.createdLabel}</td>
                <td className="px-3 py-2">
                  <Link href={l.href} className="font-semibold text-[#0b1a33] dark:text-blue-300 hover:underline">{l.name}</Link>
                </td>
                {/* Status — inline editable */}
                <td className="px-3 py-2 relative">
                  <button onClick={() => openEdit(l.id, "status")} className="text-left" title="Click to change status">
                    {l.statusLabel
                      ? <span className={`text-xs px-2 py-0.5 rounded-full ${l.statusClass}`}>{l.statusLabel}</span>
                      : <span className="text-xs text-gray-400 italic">— set status —</span>}
                  </button>
                  {editable(l.id, "status") && (
                    <EditMenu rowId={l.id} field="status" options={statuses.map((s) => ({ value: s, label: s }))} onPick={(v) => mutate([l.id], "set_status", { status: v })} />
                  )}
                </td>
                <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full border ${l.bucketClass}`}>{l.bucket}</span></td>
                {/* Agent — inline editable */}
                <td className="px-3 py-2 relative whitespace-nowrap">
                  <button onClick={() => openEdit(l.id, "agent")} className="text-gray-700 dark:text-slate-300 hover:underline" title="Click to reassign">{l.owner}</button>
                  {editable(l.id, "agent") && (
                    <EditMenu rowId={l.id} field="agent" options={agents.map((a) => ({ value: a.id, label: a.name }))} onPick={(v) => mutate([l.id], "assign", { userId: v })} />
                  )}
                </td>
                {/* Team — inline editable */}
                <td className="px-3 py-2 relative hidden sm:table-cell">
                  <button onClick={() => openEdit(l.id, "team")} className="text-gray-700 dark:text-slate-300 hover:underline" title="Click to change team">{l.team}</button>
                  {editable(l.id, "team") && (
                    <EditMenu rowId={l.id} field="team" options={teams.map((t) => ({ value: t, label: t }))} onPick={(v) => mutate([l.id], "change_team", { team: v })} />
                  )}
                </td>
                <td className="px-3 py-2 text-gray-600 dark:text-slate-400 hidden md:table-cell max-w-[160px] truncate" title={l.project}>{l.project}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-slate-400 whitespace-nowrap hidden md:table-cell">{l.sourceLabel}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-slate-400 text-xs max-w-[140px] truncate hidden lg:table-cell" title={l.importFile}>{l.importFile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-slate-500">Tip: click a Status, Agent or Team cell to edit inline. Open a lead for every other field.</p>
    </div>
  );
}

"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";

type Market = "Dubai" | "India";
export type PMRow = { id: string; name: string; developer: string; market: Market; city: string; active: boolean };

const PAGE = 50;

export default function ProjectMasterClient({ rows }: { rows: PMRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [mkt, setMkt] = useState<"all" | Market>("all");
  const [stat, setStat] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<PMRow>>({});
  const [adding, setAdding] = useState(false);
  const [neu, setNeu] = useState<{ name: string; developer: string; market: Market; city: string }>({ name: "", developer: "", market: "Dubai", city: "" });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (mkt !== "all" && r.market !== mkt) return false;
      if (stat === "active" && !r.active) return false;
      if (stat === "inactive" && r.active) return false;
      if (needle && !`${r.name} ${r.developer} ${r.city}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, q, mkt, stat]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safe = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safe * PAGE, safe * PAGE + PAGE);

  async function call(action: string, payload: Record<string, unknown>) {
    if (busy) return false;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? `Failed (${r.status})`); return false; }
      router.refresh();
      return true;
    } catch (e) { setMsg(`Network error: ${String(e).slice(0, 80)}`); return false; }
    finally { setBusy(false); }
  }

  const startEdit = (r: PMRow) => { setEdit(r.id); setDraft({ name: r.name, developer: r.developer, market: r.market, city: r.city }); };
  const saveEdit = async (id: string) => { if (await call("update", { id, ...draft })) setEdit(null); };
  const addProject = async () => {
    if (!neu.name.trim()) { setMsg("Project name is required."); return; }
    if (await call("create", neu)) { setAdding(false); setNeu({ name: "", developer: "", market: "Dubai", city: "" }); }
  };

  const input = "px-2 py-1 text-sm border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700 w-full";
  const chip = (m: Market) => m === "Dubai" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-emerald-100 text-emerald-800 border-emerald-200";

  return (
    <div className="space-y-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name / developer / city…" className="px-3 py-2 text-sm border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-800 flex-1 min-w-[200px]" />
        <select value={mkt} onChange={(e) => { setMkt(e.target.value as "all" | Market); setPage(0); }} className="text-sm border rounded-lg px-2 py-2 dark:bg-slate-800 dark:border-slate-600">
          <option value="all">All markets</option><option value="Dubai">Dubai</option><option value="India">India</option>
        </select>
        <select value={stat} onChange={(e) => { setStat(e.target.value as "all" | "active" | "inactive"); setPage(0); }} className="text-sm border rounded-lg px-2 py-2 dark:bg-slate-800 dark:border-slate-600">
          <option value="all">All status</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <button onClick={() => setAdding((a) => !a)} className="btn btn-primary text-sm">＋ Add project</button>
      </div>

      {adding && (
        <div className="card p-3 grid grid-cols-1 sm:grid-cols-5 gap-2 items-end border border-[#c9a24b]/40">
          <label className="text-xs">Project name *<input autoFocus value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} className={input} /></label>
          <label className="text-xs">Developer<input value={neu.developer} onChange={(e) => setNeu({ ...neu, developer: e.target.value })} className={input} /></label>
          <label className="text-xs">Market<select value={neu.market} onChange={(e) => setNeu({ ...neu, market: e.target.value as Market })} className={input}><option>Dubai</option><option>India</option></select></label>
          <label className="text-xs">City<input value={neu.city} onChange={(e) => setNeu({ ...neu, city: e.target.value })} placeholder={neu.market} className={input} /></label>
          <div className="flex gap-2"><button disabled={busy} onClick={addProject} className="btn btn-primary text-sm flex-1">Save</button><button onClick={() => setAdding(false)} className="btn btn-ghost text-sm">Cancel</button></div>
        </div>
      )}
      {msg && <div className="text-xs text-gray-600 dark:text-slate-300">{msg}</div>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
            <th className="px-3 py-2 font-semibold">Project Name</th>
            <th className="px-3 py-2 font-semibold">Developer</th>
            <th className="px-3 py-2 font-semibold">Market / Team</th>
            <th className="px-3 py-2 font-semibold hidden sm:table-cell">City</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold text-right">Edit</th>
          </tr></thead>
          <tbody>
            {pageRows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No projects match.</td></tr>}
            {pageRows.map((r) => {
              const e = edit === r.id;
              return (
                <tr key={r.id} className={`border-b border-[#f1f5f9] dark:border-slate-700 ${!r.active ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">{e ? <input value={draft.name ?? ""} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} className={input} /> : <span className="font-semibold">{r.name}</span>}</td>
                  <td className="px-3 py-2">{e ? <input value={draft.developer ?? ""} onChange={(ev) => setDraft({ ...draft, developer: ev.target.value })} className={input} /> : (r.developer || <span className="text-gray-300">—</span>)}</td>
                  <td className="px-3 py-2">{e
                    ? <select value={draft.market} onChange={(ev) => setDraft({ ...draft, market: ev.target.value as Market })} className={input}><option>Dubai</option><option>India</option></select>
                    : <span className={`text-xs px-2 py-0.5 rounded-full border ${chip(r.market)}`}>{r.market}</span>}</td>
                  <td className="px-3 py-2 hidden sm:table-cell">{e ? <input value={draft.city ?? ""} onChange={(ev) => setDraft({ ...draft, city: ev.target.value })} className={input} /> : (r.city || <span className="text-gray-300">—</span>)}</td>
                  <td className="px-3 py-2">
                    <button disabled={busy} onClick={() => call("update", { id: r.id, active: !r.active })} className={`text-xs px-2 py-0.5 rounded-full border ${r.active ? "bg-green-100 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-300"}`} title="Click to toggle">{r.active ? "Active" : "Inactive"}</button>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {e
                      ? <><button disabled={busy} onClick={() => saveEdit(r.id)} className="text-xs text-blue-700 font-semibold px-2">Save</button><button onClick={() => setEdit(null)} className="text-xs text-gray-500 px-1">Cancel</button></>
                      : <button onClick={() => startEdit(r)} className="text-xs text-gray-500 hover:text-[#0b1a33] dark:hover:text-blue-300 px-2">✎ Edit</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
        <span>{filtered.length} of {rows.length} projects</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button disabled={safe === 0} onClick={() => setPage(Math.max(0, safe - 1))} className="btn btn-ghost disabled:opacity-40">← Prev</button>
            <span>Page {safe + 1} / {totalPages}</span>
            <button disabled={safe >= totalPages - 1} onClick={() => setPage(Math.min(totalPages - 1, safe + 1))} className="btn btn-ghost disabled:opacity-40">Next →</button>
          </div>
        )}
      </div>
    </div>
  );
}

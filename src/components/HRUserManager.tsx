"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface U { id: string; name: string; email: string; role: string; team: string | null; active: boolean; hrOnly: boolean; }

export default function HRUserManager({ initialUsers, meId }: { initialUsers: U[]; meId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", tempPassword: "", role: "AGENT", hrOnly: true });

  async function patch(id: string, data: object) {
    setBusy(true);
    await fetch("/api/hr/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }) });
    setBusy(false); router.refresh();
  }
  async function create() {
    setErr(null);
    if (!form.name.trim() || !form.email.includes("@") || form.tempPassword.length < 8) { setErr("Name, a valid email, and an 8+ character password are required."); return; }
    setBusy(true);
    const res = await fetch("/api/hr/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const json = await res.json(); setBusy(false);
    if (!res.ok) { setErr(json.error ?? "Failed to create user."); return; }
    setShowCreate(false); setForm({ name: "", email: "", tempPassword: "", role: "AGENT", hrOnly: true }); router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600";

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-200">Users ({initialUsers.length})</h2>
        <button type="button" onClick={() => setShowCreate(s => !s)} className="text-sm px-3 py-1.5 rounded-lg bg-[#1a2e4a] text-white hover:bg-[#243d60]">{showCreate ? "Cancel" : "+ Add User"}</button>
      </div>

      {showCreate && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input className={inp} placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className={inp} placeholder="Login email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value.toLowerCase() }))} />
            <input className={inp} placeholder="Temp password (8+ chars)" value={form.tempPassword} onChange={e => setForm(f => ({ ...f, tempPassword: e.target.value }))} />
            <select className={inp} value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="ADMIN">Super Admin (ADMIN)</option>
              <option value="MANAGER">Manager</option>
              <option value="AGENT">Recruiter / Agent</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
            <input type="checkbox" checked={form.hrOnly} onChange={e => setForm(f => ({ ...f, hrOnly: e.target.checked }))} />
            HR-only (cannot access the Sales CRM — recommended for recruiters &amp; interns)
          </label>
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
          <button type="button" disabled={busy} onClick={create} className="btn btn-primary justify-center">{busy ? "Creating…" : "Create User"}</button>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2.5">Name</th><th className="px-3 py-2.5">Email</th><th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5 text-center">HR-only</th><th className="px-3 py-2.5 text-center">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {initialUsers.map(u => (
              <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap">{u.name}{u.id === meId && <span className="text-[10px] text-gray-400 ml-1">(you)</span>}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{u.email}</td>
                <td className="px-3 py-2.5">
                  <select disabled={busy} value={u.role} onChange={e => patch(u.id, { role: e.target.value })} className="text-xs border border-gray-200 rounded px-2 py-1 dark:bg-slate-800 dark:border-slate-600">
                    <option value="ADMIN">Admin</option><option value="MANAGER">Manager</option><option value="AGENT">Agent</option>
                  </select>
                </td>
                <td className="px-3 py-2.5 text-center"><input type="checkbox" disabled={busy} checked={u.hrOnly} onChange={e => patch(u.id, { hrOnly: e.target.checked })} /></td>
                <td className="px-3 py-2.5 text-center"><input type="checkbox" disabled={busy || u.id === meId} checked={u.active} onChange={e => patch(u.id, { active: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

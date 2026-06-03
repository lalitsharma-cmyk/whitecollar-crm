"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  team: string | null;
  active: boolean;
}

// ─── Invite Modal ─────────────────────────────────────────────────────────────

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("AGENT");
  const [team, setTeam] = useState("Dubai");
  const [tempPassword, setTempPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useBodyScrollLock(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, team: team || null, tempPassword }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed to invite user"); return; }
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <form
        onSubmit={submit}
        className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="invite-modal-title" className="font-semibold text-lg mb-4 text-gray-900 dark:text-slate-100">
          Invite Agent
        </h2>

        <div className="space-y-3">
          {/* Full name */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">
              Full name <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder="e.g. Priya Sharma"
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 placeholder:text-gray-400"
            />
          </div>

          {/* Email */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">
              Email <span className="text-red-600">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              placeholder="agent@whitecollarrealty.com"
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 placeholder:text-gray-400"
            />
          </div>

          {/* Role */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">
              Role <span className="text-red-600">*</span>
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={busy}
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="AGENT">AGENT</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>

          {/* Team */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">Team</label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              disabled={busy}
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="Dubai">Dubai</option>
              <option value="India">India</option>
            </select>
          </div>

          {/* Temporary password */}
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">
              Temporary password <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              required
              minLength={8}
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              disabled={busy}
              placeholder="Share this manually with the agent"
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-slate-700 dark:text-slate-100 placeholder:text-gray-400 placeholder:font-sans"
            />
            <p className="text-[10px] text-gray-400 mt-0.5">Min 8 characters. Share this with the agent — they can change it from their profile.</p>
          </div>
        </div>

        {err && (
          <div className="text-xs text-red-600 mt-3" role="alert">{err}</div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn btn-ghost"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="btn btn-primary disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Edit Role/Team Modal ─────────────────────────────────────────────────────

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState(user.role);
  const [team, setTeam] = useState(user.team ?? "Dubai");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useBodyScrollLock(true);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, team: team || null }),
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "Failed"); return; }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-modal-title"
    >
      <form
        onSubmit={submit}
        className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-sm w-full p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-user-modal-title" className="font-semibold text-base mb-1 text-gray-900 dark:text-slate-100">
          Edit {user.name}
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{user.email}</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={busy}
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="AGENT">AGENT</option>
              <option value="MANAGER">MANAGER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-400">Team</label>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              disabled={busy}
              className="mt-1 w-full border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="Dubai">Dubai</option>
              <option value="India">India</option>
            </select>
          </div>
        </div>

        {err && <div className="text-xs text-red-600 mt-3" role="alert">{err}</div>}

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-60">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

interface Props {
  initialUsers: Array<UserRow & { _count: { ownedLeads: number; callLogs: number }; createdAt: Date }>;
  currentUserId: string;
}

export default function AdminUsersClient({ initialUsers, currentUserId }: Props) {
  const router = useRouter();
  const [showInvite, setShowInvite] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function refresh() {
    router.refresh();
  }

  async function toggleActive(user: UserRow) {
    if (togglingId) return;
    setTogglingId(user.id);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/toggle-active`, {
        method: "PATCH",
      });
      const j = await r.json();
      if (!r.ok) {
        window.alert(j.error ?? "Failed to update user");
        return;
      }
      refresh();
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <>
      {/* Invite button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowInvite(true)}
          className="btn btn-primary text-sm"
        >
          + Invite Agent
        </button>
      </div>

      {/* Users table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 font-medium text-right">Leads</th>
              <th className="px-4 py-3 font-medium text-right">Calls</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.map((user) => {
              const chipClass =
                user.role === "ADMIN"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300"
                  : user.role === "MANAGER"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300";

              const teamClass =
                user.team === "Dubai"
                  ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
                  : user.team === "India"
                  ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300";

              const isSelf = user.id === currentUserId;
              const isToggling = togglingId === user.id;

              return (
                <tr
                  key={user.id}
                  className={`border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-800/40 ${
                    !user.active ? "opacity-60" : ""
                  }`}
                >
                  {/* Name */}
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap">
                    {user.name}
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400 max-w-[220px] truncate">
                    {user.email}
                  </td>

                  {/* Role chip */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${chipClass}`}>
                      {user.role}
                    </span>
                  </td>

                  {/* Team badge */}
                  <td className="px-4 py-3">
                    {user.team ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${teamClass}`}>
                        {user.team}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                        Unassigned
                      </span>
                    )}
                  </td>

                  {/* Leads count */}
                  <td className="px-4 py-3 text-right">
                    <a
                      href={`/leads?owner=${user.id}`}
                      className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      {user._count.ownedLeads}
                    </a>
                  </td>

                  {/* Call logs count */}
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300 font-medium">
                    {user._count.callLogs}
                  </td>

                  {/* Joined date */}
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap text-xs">
                    {new Date(user.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </td>

                  {/* Active status badge */}
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.active
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      }`}
                    >
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {/* Edit role/team */}
                      <button
                        type="button"
                        onClick={() =>
                          setEditTarget({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            team: user.team,
                            active: user.active,
                          })
                        }
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        Edit
                      </button>

                      {/* Deactivate / Reactivate — hidden for self */}
                      {!isSelf && (
                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => toggleActive(user)}
                          className={`text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                            user.active
                              ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
                              : "border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
                          }`}
                        >
                          {isToggling ? "…" : user.active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Invite modal */}
      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={() => {
            setShowInvite(false);
            refresh();
          }}
        />
      )}

      {/* Edit role/team modal */}
      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

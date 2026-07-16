"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import { backdropProps } from "@/lib/useDismiss";

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
      {...backdropProps(onClose)}
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
      {...backdropProps(onClose)}
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

// ─── Sessions / Force Logout modal ────────────────────────────────────────────

interface SessionInfo {
  id: string;
  summary: string;
  os: string;
  browser: string;
  possiblePwa: boolean;
  deviceName: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
}

interface SessionsPayload {
  user: { id: string; name: string; email: string; isSuperAdmin: boolean };
  sessions: SessionInfo[];
  recentRevoked: SessionInfo[];
  legacyCookieRisk: boolean;
  canForceLogout: boolean;
}

function deviceEmoji(os: string): string {
  if (os === "iPhone" || os === "iPad" || os === "Android") return "📱";
  if (os === "Windows") return "🖥️";
  if (os === "Mac" || os === "Linux") return "💻";
  return "🌐";
}

function fmtIST(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }) + " IST"
  );
}

function SessionsModal({
  user,
  isSelf,
  onClose,
}: {
  user: UserRow;
  isSelf: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<SessionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useBodyScrollLock(true);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/sessions`);
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? "Failed to load sessions");
        return;
      }
      setData(j);
    } catch {
      setErr("Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revokeOne(s: SessionInfo) {
    if (busyId || busyAll) return;
    if (
      s.current &&
      !window.confirm("This is YOUR current session — you will be signed out immediately. Continue?")
    ) {
      return;
    }
    setBusyId(s.id);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/sessions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: s.id }),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? "Failed to log out session");
        return;
      }
      if (j.selfLogout) {
        // We just ended our own session — the very next request is unauthenticated.
        window.location.href = "/login";
        return;
      }
      setResult("Session ended — that device is logged out on its next request.");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function forceLogoutAll() {
    if (busyAll || busyId) return;
    setBusyAll(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/users/${user.id}/sessions`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? "Force logout failed");
        return;
      }
      if (j.selfLogout) {
        // Our own session died with the rest — go to login cleanly.
        window.location.href = "/login";
        return;
      }
      setConfirmAll(false);
      setResult(
        `Force logout done — ${j.revoked} active session${j.revoked === 1 ? "" : "s"} ended and old app/browser logins invalidated. ${user.name} keeps their password and simply signs in again.`
      );
      await load();
    } finally {
      setBusyAll(false);
    }
  }

  const sessions = data?.sessions ?? [];
  const recentRevoked = data?.recentRevoked ?? [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4"
      {...backdropProps(onClose)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sessions-modal-title"
    >
      <div
        className="bg-white dark:bg-slate-800 sm:rounded-xl rounded-t-2xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sessions-modal-title" className="font-semibold text-base mb-1 text-gray-900 dark:text-slate-100">
          🔒 Sessions — {user.name}
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">{user.email}</p>

        {loading && (
          <div className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">Loading sessions…</div>
        )}

        {err && (
          <div className="text-xs text-red-600 mb-3" role="alert">
            {err}
          </div>
        )}

        {!loading && data && (
          <>
            {/* ── Active sessions ── */}
            <div className="space-y-2">
              {sessions.length === 0 && (
                <div className="text-sm text-gray-400 dark:text-slate-500 border border-dashed border-gray-200 dark:border-slate-700 rounded-lg p-4 text-center">
                  No active sessions.
                </div>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-start gap-3 border border-gray-200 dark:border-slate-700 rounded-lg p-3"
                >
                  <div className="text-xl leading-none mt-0.5" aria-hidden="true">
                    {deviceEmoji(s.os)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{s.summary}</span>
                      {s.current && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          This device (you)
                        </span>
                      )}
                      {s.possiblePwa && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          title="Looks like an installed app (PWA) or in-app browser"
                        >
                          possible PWA
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">
                      {(s.city || s.country) && (
                        <span>
                          📍 {[s.city, s.country].filter(Boolean).join(", ")}
                          {" · "}
                        </span>
                      )}
                      Signed in {fmtIST(s.createdAt)}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-slate-400">
                      Last active {fmtIST(s.lastActiveAt)}
                      {s.ip ? ` · ${s.ip}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === s.id || busyAll}
                    onClick={() => revokeOne(s)}
                    className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 shrink-0"
                  >
                    {busyId === s.id ? "…" : "Log out"}
                  </button>
                </div>
              ))}
            </div>

            {/* ── Recently logged out (context tail) ── */}
            {recentRevoked.length > 0 && (
              <div className="mt-4">
                <div className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wide mb-1.5">
                  Recently logged out
                </div>
                <div className="space-y-1">
                  {recentRevoked.map((s) => (
                    <div key={s.id} className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1.5">
                      <span aria-hidden="true">{deviceEmoji(s.os)}</span>
                      <span className="truncate">
                        {s.summary}
                        {s.revokedAt ? ` — ended ${fmtIST(s.revokedAt)}` : ""}
                        {s.revokedReason ? ` (${s.revokedReason})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Legacy-cookie explainer ── */}
            {data.legacyCookieRisk && (
              <div className="mt-4 text-[11px] leading-relaxed rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 p-3">
                ⚠️ This account has never had a session reset, so logins from before device security
                (old iPhone app / Safari installs) may still be signed in <b>without appearing above</b>.
                “Force Logout — All Devices” is the only way to end those too.
              </div>
            )}

            {/* ── Result ── */}
            {result && (
              <div className="mt-4 text-xs rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 p-3">
                ✅ {result}
              </div>
            )}

            {/* ── Force Logout — All Devices ── */}
            <div className="mt-4 rounded-lg border border-red-200 dark:border-red-900/50 p-3">
              {!data.canForceLogout ? (
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Only a super-admin can force-logout a super-admin.
                </p>
              ) : !confirmAll ? (
                <button
                  type="button"
                  onClick={() => setConfirmAll(true)}
                  disabled={busyAll || busyId !== null}
                  className="w-full text-sm font-semibold px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  🔒 Force Logout — All Devices
                </button>
              ) : (
                <div>
                  <p className="text-xs text-gray-700 dark:text-slate-300 leading-relaxed">
                    Ends every session on every device (including old PWA/Safari logins).{" "}
                    <b>{user.name}</b> keeps their password and simply signs in again.
                  </p>
                  {isSelf && (
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400 mt-1.5">
                      ⚠️ This is your own account — you will be signed out immediately.
                    </p>
                  )}
                  <div className="flex justify-end gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setConfirmAll(false)}
                      disabled={busyAll}
                      className="btn btn-ghost text-xs"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={forceLogoutAll}
                      disabled={busyAll}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-60"
                    >
                      {busyAll ? "Logging out…" : "Yes, force logout"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end mt-5">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Close
          </button>
        </div>
      </div>
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
  const [sessionsTarget, setSessionsTarget] = useState<UserRow | null>(null);
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

                      {/* Sessions / Force Logout */}
                      <button
                        type="button"
                        onClick={() =>
                          setSessionsTarget({
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            role: user.role,
                            team: user.team,
                            active: user.active,
                          })
                        }
                        title="View active sessions / force logout"
                        className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        Sessions
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

      {/* Sessions / Force Logout modal */}
      {sessionsTarget && (
        <SessionsModal
          user={sessionsTarget}
          isSelf={sessionsTarget.id === currentUserId}
          onClose={() => setSessionsTarget(null)}
        />
      )}
    </>
  );
}

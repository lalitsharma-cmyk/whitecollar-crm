"use client";

// Client half of /admin/presence — renders the live board from the
// server-provided initial snapshot, then polls GET /api/admin/presence every
// 30s (only while the tab is visible; background polls pass poll=1 so they
// aren't re-audit-logged). Expandable per-user device rows + a session-history
// drawer (GET /api/admin/presence/history).
//
// NOTE: import ONLY TYPES from "@/lib/presence" here (type imports are erased
// at build time) — importing a value would pull prisma into the client bundle.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type {
  PresenceHistoryDay,
  PresenceOverview,
  PresenceSessionView,
  PresenceStatus,
  PresenceUserRow,
} from "@/lib/presence";
import { fmtIST, fmtISTLabelled, fmtISTTime } from "@/lib/datetime";
import { backdropProps } from "@/lib/useDismiss";

const REFRESH_MS = 30_000; // keep in sync with OVERVIEW_REFRESH_MS in src/lib/presence.ts

// ── Status chip visuals ──────────────────────────────────────────────────────
const STATUS_META: Record<PresenceStatus, { label: string; cls: string; dot: string }> = {
  ONLINE: {
    label: "Online",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
    dot: "bg-emerald-500",
  },
  IDLE: {
    label: "Idle",
    cls: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
    dot: "bg-amber-500",
  },
  OFFLINE: {
    label: "Offline",
    cls: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    dot: "bg-gray-400",
  },
  NEVER_ACTIVE_TODAY: {
    label: "Never Active Today",
    cls: "bg-transparent text-gray-400 border-gray-300 border-dashed dark:text-slate-500 dark:border-slate-600",
    dot: "bg-gray-300",
  },
};

function StatusChip({ status }: { status: PresenceStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === "ONLINE" ? "animate-pulse" : ""}`} />
      {m.label}
    </span>
  );
}

// ── Small display helpers ────────────────────────────────────────────────────
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 2) return "1 minute ago";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 2) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d < 2 ? "1 day ago" : `${d} days ago`;
}

function fmtDuration(min: number): string {
  if (min < 1) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m`;
}

/** Today's IST calendar date "YYYY-MM-DD" (client-side, matching istDateKey). */
function todayISTKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function roleLabel(role: string): string {
  return role === "ADMIN" ? "Admin" : role === "MANAGER" ? "Manager" : role === "AGENT" ? "Agent" : role;
}

function PwaBadge() {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800 font-semibold">
      PWA
    </span>
  );
}

// ── Session sub-row (expanded device list + history drawer share this) ──────
function SessionRow({ s }: { s: PresenceSessionView }) {
  return (
    <tr className="border-b border-[#f1f5f9] dark:border-slate-700/60 last:border-0">
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className="font-medium">{s.device}</span>
        <span className="text-gray-500 dark:text-slate-400"> · {s.browser}</span>
        {s.os !== s.device && <span className="text-gray-400 dark:text-slate-500"> · {s.os}</span>}{" "}
        {s.isPwa && <PwaBadge />}
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        <span className="font-medium">{s.currentModule}</span>
        <span className="text-xs text-gray-400 dark:text-slate-500 block truncate max-w-[180px]" title={s.currentRoute}>
          {s.currentRoute}
        </span>
      </td>
      <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap tabular-nums" title={fmtISTLabelled(s.sessionStart)}>
        {fmtISTTime(s.sessionStart)}
      </td>
      <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap" title={fmtISTLabelled(s.lastActivityAt)}>
        {timeAgo(s.lastActivityAt)}
      </td>
      <td className="px-3 py-1.5 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap tabular-nums">{fmtDuration(s.durationMin)}</td>
      <td className="px-3 py-1.5"><StatusChip status={s.status} /></td>
    </tr>
  );
}

function SessionTable({ sessions }: { sessions: PresenceSessionView[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#f1f5f9] dark:border-slate-700">
            <th className="px-3 py-1.5 font-semibold">Device</th>
            <th className="px-3 py-1.5 font-semibold">Module / Route</th>
            <th className="px-3 py-1.5 font-semibold">Started</th>
            <th className="px-3 py-1.5 font-semibold">Last activity</th>
            <th className="px-3 py-1.5 font-semibold">Duration</th>
            <th className="px-3 py-1.5 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => <SessionRow key={s.id} s={s} />)}
        </tbody>
      </table>
    </div>
  );
}

// ── History drawer ───────────────────────────────────────────────────────────
function HistoryDrawer({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const [dateKey, setDateKey] = useState<string>(todayISTKey);
  const [data, setData] = useState<PresenceHistoryDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/presence/history?userId=${encodeURIComponent(userId)}&date=${encodeURIComponent(dateKey)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Request failed (${r.status})`);
        return r.json() as Promise<PresenceHistoryDay>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, dateKey]);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" {...backdropProps(onClose)}>
      <div className="h-full w-full max-w-[460px] bg-white dark:bg-slate-900 shadow-2xl overflow-y-auto p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Session history</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">{name} · one IST day at a time</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
            aria-label="Close history"
          >
            ✕
          </button>
        </div>

        <label className="block text-sm">
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Day (IST)</span>
          <input
            type="date"
            value={dateKey}
            max={todayISTKey()}
            onChange={(e) => e.target.value && setDateKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
          />
        </label>

        {loading ? (
          <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>
        ) : error ? (
          <div className="text-sm text-rose-600 py-4">{error}</div>
        ) : !data || data.sessionCount === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">No CRM sessions on this day.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="card p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">First seen</div>
                <div className="font-semibold tabular-nums" title={data.firstSeenAt ? fmtISTLabelled(data.firstSeenAt) : undefined}>
                  {data.firstSeenAt ? fmtIST(data.firstSeenAt) : "—"}
                </div>
              </div>
              <div className="card p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Last seen</div>
                <div className="font-semibold tabular-nums" title={data.lastSeenAt ? fmtISTLabelled(data.lastSeenAt) : undefined}>
                  {data.lastSeenAt ? fmtIST(data.lastSeenAt) : "—"}
                </div>
              </div>
              <div className="card p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Time on CRM</div>
                <div className="font-semibold">{fmtDuration(data.totalDurationMin)}</div>
              </div>
              <div className="card p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-gray-400">Interactions</div>
                <div className="font-semibold tabular-nums">{data.totalActivity}</div>
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 border-b border-[#f1f5f9] dark:border-slate-700">
                {data.sessionCount} session{data.sessionCount === 1 ? "" : "s"}
              </div>
              <SessionTable sessions={data.sessions} />
            </div>
            <p className="text-[11px] text-gray-400 dark:text-slate-500">
              Session telemetry (CRM open in a browser/PWA) — not attendance. Attendance stays in Admin → Attendance.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────────────────
export default function PresenceDashboard({ initial }: { initial: PresenceOverview }) {
  const [data, setData] = useState<PresenceOverview>(initial);
  const [status, setStatus] = useState<string>("");
  const [team, setTeam] = useState<string>("");
  const [role, setRole] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<{ userId: string; name: string } | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const firstRender = useRef(true);

  const filtersRef = useRef({ status, team, role, q });
  filtersRef.current = { status, team, role, q };

  const load = useCallback(async (poll: boolean) => {
    try {
      const f = filtersRef.current;
      const params = new URLSearchParams();
      if (f.status) params.set("status", f.status);
      if (f.team) params.set("team", f.team);
      if (f.role) params.set("role", f.role);
      if (f.q.trim()) params.set("q", f.q.trim());
      if (poll) params.set("poll", "1");
      const r = await fetch(`/api/admin/presence?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${r.status})`);
      }
      setData((await r.json()) as PresenceOverview);
      setFetchedAt(Date.now());
      setError(null);
    } catch (e: unknown) {
      // Keep showing the last good snapshot; just surface a soft warning.
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  }, []);

  // Filter changes → immediate (audited) fetch. Skip the very first render —
  // the server already provided the initial snapshot.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const t = setTimeout(() => void load(false), q ? 250 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [status, team, role, q, load]);

  // 30s auto-refresh — visible tabs only; immediate refresh when the tab
  // becomes visible again (same pattern as DashboardLiveRefresh).
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void load(true); };
    const iv = setInterval(tick, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  const toggle = (userId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });

  const counts = data.counts;
  const chip = (value: string, label: string, count: number, activeCls: string) => (
    <button
      key={value || "all"}
      type="button"
      onClick={() => setStatus((cur) => (cur === value ? "" : value))}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
        status === value
          ? activeCls
          : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800"
      }`}
    >
      {label} · <span className="font-semibold tabular-nums">{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Summary + freshness */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {chip("ONLINE", "🟢 Online", counts.online, "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700")}
          {chip("IDLE", "🟡 Idle", counts.idle, "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700")}
          {chip("OFFLINE", "⚪ Offline", counts.offline, "border-gray-300 bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600")}
          {chip("NEVER_ACTIVE_TODAY", "◌ Never active today", counts.neverActiveToday, "border-gray-400 border-dashed bg-gray-50 text-gray-600 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-500")}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-2">
          {error && <span className="text-amber-600 dark:text-amber-400">⚠ {error}</span>}
          <span title={fmtISTLabelled(data.generatedAt)}>Updated {timeAgo(new Date(fetchedAt).toISOString())}</span>
          <button
            type="button"
            onClick={() => void load(false)}
            className="px-2 py-0.5 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-500 dark:text-slate-400"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-sm w-56"
        />
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
        >
          <option value="">All teams</option>
          {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
        >
          <option value="">All roles</option>
          <option value="ADMIN">Admin</option>
          <option value="MANAGER">Manager</option>
          <option value="AGENT">Agent</option>
        </select>
        {(status || team || role || q) && (
          <button
            type="button"
            onClick={() => { setStatus(""); setTeam(""); setRole(""); setQ(""); }}
            className="text-xs text-gray-500 dark:text-slate-400 underline underline-offset-2"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Roster table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#f1f5f9] dark:border-slate-700">
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold hidden sm:table-cell">Team</th>
                <th className="px-3 py-2 font-semibold hidden md:table-cell">Role</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Last seen</th>
                <th className="px-3 py-2 font-semibold hidden sm:table-cell">Devices</th>
                <th className="px-3 py-2 font-semibold text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400">
                    No users match these filters.
                  </td>
                </tr>
              )}
              {data.users.map((u: PresenceUserRow) => {
                const open = expanded.has(u.userId);
                return (
                  <Fragment key={u.userId}>
                    <tr
                      className="border-b border-[#f1f5f9] dark:border-slate-700 hover:bg-gray-50/60 dark:hover:bg-slate-800/40 cursor-pointer"
                      onClick={() => toggle(u.userId)}
                    >
                      <td className="px-4 py-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-gray-400 dark:text-slate-500 truncate max-w-[180px]">{u.email}</div>
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell text-gray-600 dark:text-slate-300">{u.team}</td>
                      <td className="px-3 py-2 hidden md:table-cell text-gray-600 dark:text-slate-300">{roleLabel(u.role)}</td>
                      <td className="px-3 py-2"><StatusChip status={u.status} /></td>
                      <td className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap" title={u.lastSeenAt ? fmtISTLabelled(u.lastSeenAt) : "Never seen"}>
                        {timeAgo(u.lastSeenAt)}
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell text-gray-600 dark:text-slate-300 tabular-nums">
                        {u.deviceCount > 0 ? u.deviceCount : "—"}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setHistory({ userId: u.userId, name: u.name }); }}
                          className="text-xs px-2 py-1 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 mr-1"
                        >
                          History
                        </button>
                        <span className="text-gray-400 text-xs select-none">{open ? "▲" : "▼"}</span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-[#f1f5f9] dark:border-slate-700 bg-gray-50/40 dark:bg-slate-800/30">
                        <td colSpan={7} className="px-4 py-2">
                          {u.sessions.length === 0 ? (
                            <div className="text-xs text-gray-400 py-1.5">No sessions today (IST).</div>
                          ) : (
                            <SessionTable sessions={u.sessions} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        Online = heartbeat in the last 90s · Idle = CRM open but no interaction for 5+ min · Offline = no heartbeat
        for 90s+ or tab closed · Never Active Today = no CRM session this IST day. Presence stores route + module
        only — never message content, numbers or field values.
      </p>

      {history && (
        <HistoryDrawer userId={history.userId} name={history.name} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ACTIVITY_SOURCE_MODULES } from "@/lib/moduleSource";

// Call-Logs filter bar — URL-param driven (mirrors the LeadFilters pattern so the
// page stays a cache-friendly RSC and every filter is a shareable link).
//
// Filters: Date Range · Team · User · Module · Call Status + a debounced Search box.
//
// TEAM → USER CASCADE (the key requirement): the full active-user roster is passed
// in from the server WITH each user's team. When a Team is picked, the User dropdown
// is filtered CLIENT-SIDE to just that team's users — no round-trip. Picking a team
// also clears a now-out-of-team user selection so the two never contradict. The
// server still re-derives + re-enforces scope from the URL params (this is UX only).

interface UserOpt { id: string; name: string; team: string | null }
interface OutcomeOpt { value: string; label: string }

interface Props {
  users: UserOpt[];
  outcomes: OutcomeOpt[];
  /** Whether to show the Team + User pickers (hidden for AGENT — they only see self). */
  showScopePickers: boolean;
  /** Whether to show the Team picker specifically (hidden for a team-locked MANAGER). */
  showTeamPicker: boolean;
}

const TEAMS = [
  { v: "", l: "All Teams" },
  { v: "India", l: "🇮🇳 India Team" },
  { v: "Dubai", l: "🇦🇪 Dubai Team" },
];

// Normalize a user's stored team string to the India/Dubai buckets the cascade uses.
// Mirrors teamRouting.normalizeTeam but kept local so this stays a pure client file.
function bucketTeam(t: string | null): "India" | "Dubai" | null {
  const s = (t ?? "").trim().toLowerCase();
  if (s === "dubai" || s === "uae" || s === "dxb" || s === "ae") return "Dubai";
  if (s === "india" || s === "in" || s === "ind" || s === "bharat") return "India";
  return null;
}

export default function CallLogFilters({ users, outcomes, showScopePickers, showTeamPicker }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // Debounced free-text search (name / mobile / agent).
  const [q, setQ] = useState(sp.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") === q) return;
      const p = new URLSearchParams(sp.toString());
      if (q) p.set("q", q); else p.delete("q");
      p.delete("page");
      router.replace(`${pathname}?${p.toString()}`);
    }, 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const team = sp.get("team") ?? "";
  const user = sp.get("user") ?? "";
  const moduleParam = sp.get("module") ?? "";
  const outcome = sp.get("outcome") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  // The User dropdown options cascade off the selected Team (client-side filter).
  const visibleUsers = team
    ? users.filter((u) => bucketTeam(u.team) === team)
    : users;

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  function onTeamChange(value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set("team", value); else p.delete("team");
    // Drop a user selection that no longer belongs to the chosen team so the two
    // filters can never contradict each other.
    if (user) {
      const stillValid = users.some((u) => u.id === user && (!value || bucketTeam(u.team) === value));
      if (!stillValid) p.delete("user");
    }
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  const hasFilters = !!(team || user || moduleParam || outcome || from || to || sp.get("q"));

  const selCls =
    "border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-400";
  const lblCls =
    "text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide";

  return (
    <div className="card p-4 space-y-3">
      {/* Search */}
      <input
        type="search"
        placeholder="Search customer name, mobile, or agent…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0b1a33]/20"
      />

      {/* Filter row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range */}
        <div className="flex flex-col gap-1">
          <label className={lblCls}>From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setParam("from", e.target.value)}
            className={selCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={lblCls}>To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setParam("to", e.target.value)}
            className={selCls}
          />
        </div>

        {/* Team (scope-gated) */}
        {showScopePickers && showTeamPicker && (
          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className={lblCls}>Team</label>
            <select value={team} onChange={(e) => onTeamChange(e.target.value)} className={selCls}>
              {TEAMS.map((t) => (
                <option key={t.v} value={t.v}>{t.l}</option>
              ))}
            </select>
          </div>
        )}

        {/* User (cascades off Team) */}
        {showScopePickers && (
          <div className="flex flex-col gap-1 min-w-[170px]">
            <label className={lblCls}>User</label>
            <select value={user} onChange={(e) => setParam("user", e.target.value)} className={selCls}>
              <option value="">All users</option>
              {visibleUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Module */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className={lblCls}>Module</label>
          <select value={moduleParam} onChange={(e) => setParam("module", e.target.value)} className={selCls}>
            <option value="">All modules</option>
            {ACTIVITY_SOURCE_MODULES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Call Status (outcome) */}
        <div className="flex flex-col gap-1 min-w-[160px]">
          <label className={lblCls}>Call Status</label>
          <select value={outcome} onChange={(e) => setParam("outcome", e.target.value)} className={selCls}>
            <option value="">All statuses</option>
            {outcomes.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => router.replace(pathname)}
            className="btn btn-ghost"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

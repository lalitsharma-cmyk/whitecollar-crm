"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { ACTIVITY_SOURCE_MODULES } from "@/lib/moduleSource";

// Call-Logs filter bar — URL-param driven (mirrors the LeadFilters pattern so the
// page stays a cache-friendly RSC and every filter is a shareable link).
//
// Filters: Date Range · Team · User · Module · Call Status · Call State + a
// debounced Search box.
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
  /** The date window the SERVER actually applied. The page defaults to today when
   *  no range is in the URL, so the inputs must show the resolved dates — not the
   *  empty params — or the bar would read "no dates" while the table shows one day. */
  effectiveFrom: string;
  effectiveTo: string;
  /** True when ?range=all is pinned (the explicit unbounded/history view). */
  rangeAll: boolean;
  /** Today in IST (YYYY-MM-DD) — for the quick-range buttons and the Today check. */
  istToday: string;
}

/** Shift an IST YYYY-MM-DD by N days. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

export default function CallLogFilters({
  users, outcomes, showScopePickers, showTeamPicker,
  effectiveFrom, effectiveTo, rangeAll, istToday,
}: Props) {
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
  const state = sp.get("state") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  // The User dropdown options cascade off the selected Team (client-side filter).
  const visibleUsers = team
    ? users.filter((u) => bucketTeam(u.team) === team)
    : users;

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value); else p.delete(key);
    // Touching a date leaves the explicit all-time view — otherwise range=all
    // would keep overriding the date the operator just typed and the input would
    // appear to do nothing.
    if (key === "from" || key === "to") p.delete("range");
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  /** Quick ranges. Writes BOTH ends so the window is unambiguous, and drops the
   *  outcome/state pin? No — the pin is deliberately kept: an operator narrowing
   *  "Not Picked" from today to last-7-days expects to still be looking at Not
   *  Picked. Only the page resets. */
  function setRange(from: string, to: string, all = false) {
    const p = new URLSearchParams(sp.toString());
    if (all) {
      p.set("range", "all");
      p.delete("from");
      p.delete("to");
    } else {
      p.delete("range");
      p.set("from", from);
      p.set("to", to);
    }
    p.delete("page");
    router.replace(`${pathname}?${p.toString()}`);
  }

  const isToday = !rangeAll && effectiveFrom === istToday && effectiveTo === istToday;
  const quick: { label: string; on: boolean; go: () => void }[] = [
    { label: "Today", on: isToday, go: () => setRange(istToday, istToday) },
    {
      label: "Yesterday",
      on: !rangeAll && effectiveFrom === addDays(istToday, -1) && effectiveTo === addDays(istToday, -1),
      go: () => setRange(addDays(istToday, -1), addDays(istToday, -1)),
    },
    {
      label: "Last 7 days",
      on: !rangeAll && effectiveFrom === addDays(istToday, -6) && effectiveTo === istToday,
      go: () => setRange(addDays(istToday, -6), istToday),
    },
    {
      label: "Last 30 days",
      on: !rangeAll && effectiveFrom === addDays(istToday, -29) && effectiveTo === istToday,
      go: () => setRange(addDays(istToday, -29), istToday),
    },
    { label: "All time", on: rangeAll, go: () => setRange("", "", true) },
  ];

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

  const hasFilters = !!(team || user || moduleParam || outcome || state || from || to || sp.get("q"));

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

      {/* Quick ranges — the default is Today, so the common windows are one click
          and From/To is reserved for a deliberate historical report. */}
      <div className="flex flex-wrap gap-1.5">
        {quick.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={r.go}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
              r.on
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-gray-400 dark:hover:border-slate-500"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3 items-end">
        {/* Date range — bound to the EFFECTIVE dates so the inputs show the window
            the server applied (today, when nothing is in the URL). */}
        <div className="flex flex-col gap-1">
          <label className={lblCls}>From</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setParam("from", e.target.value)}
            className={selCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={lblCls}>To</label>
          <input
            type="date"
            value={effectiveTo}
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

        {/* Call State — resolved vs unresolved dial (Lalit P0 2026-07-18).
            Separate from Call Status on purpose: Status pins ONE outcome,
            State splits the whole list into "a result was recorded" vs "the
            agent tapped Call and nothing came back yet". The Pending option is
            the operational queue — dials stuck unresolved (app closed mid-call,
            telephony webhook never landed) that would otherwise be invisible. */}
        <div className="flex flex-col gap-1 min-w-[190px]">
          <label className={lblCls}>Call State</label>
          <select value={state} onChange={(e) => setParam("state", e.target.value)} className={selCls}>
            <option value="">All dials</option>
            <option value="resolved">✅ Resolved (real calls)</option>
            <option value="pending">⏳ Pending / unresolved</option>
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

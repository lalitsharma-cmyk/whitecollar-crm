"use client";
import { useEffect, useMemo, useRef, useState } from "react";

interface U { id: string; name: string; team: string | null; role: string; isSuperAdmin: boolean; }

// Mandatory, searchable "Assign To" picker for the New Lead form. It filters the
// roster by the currently-selected team: that team's active agents PLUS
// cross-team owners (admins like Lalit/Samir) PLUS unteamed users. HR/inactive/
// deleted users are never passed in (filtered server-side). Enforces a selection
// via setCustomValidity so the form cannot submit without an owner. Posts the
// chosen user id as hidden input `ownerId`.
//
// TEAM SOURCE: when a controlled `team` prop is passed (RequirementSection owns
// Team in React state), this component uses it directly and re-filters reactively
// — no DOM listening. When `team` is undefined (standalone use), it falls back to
// watching the sibling <select name="forwardedTeam"> change events.
export default function AssignToSelect({ users, initialTeam, team: teamProp }: { users: U[]; initialTeam: string; team?: string }) {
  const controlled = teamProp !== undefined;
  const [team, setTeam] = useState(controlled ? (teamProp as string) : initialTeam);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<U | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Controlled mode: track the prop. Changing team also resets the current pick
  // (a teammate from the old team shouldn't stay selected).
  useEffect(() => {
    if (!controlled) return;
    setTeam(teamProp as string);
    setPicked(null);
    setQuery("");
  }, [controlled, teamProp]);

  // Uncontrolled fallback: follow the sibling Team select so the agent list
  // re-filters on team change.
  useEffect(() => {
    if (controlled) return;
    const sel = document.querySelector('select[name="forwardedTeam"]') as HTMLSelectElement | null;
    if (!sel) return;
    setTeam(sel.value);
    const onChange = () => { setTeam(sel.value); setPicked(null); setQuery(""); };
    sel.addEventListener("change", onChange);
    return () => sel.removeEventListener("change", onChange);
  }, [controlled]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const eligible = useMemo(
    () => users
      .filter((u) => u.team === team || u.role === "ADMIN" || u.isSuperAdmin || !u.team)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users, team],
  );

  // Drop a pick that's no longer valid for the newly-selected team.
  useEffect(() => { if (picked && !eligible.some((u) => u.id === picked.id)) setPicked(null); }, [eligible, picked]);

  // Mandatory: the field stays invalid until a user is actually picked.
  useEffect(() => {
    inputRef.current?.setCustomValidity(picked ? "" : "Select an agent to assign this lead to.");
  }, [picked]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? eligible.filter((u) => u.name.toLowerCase().includes(q)) : eligible;
    return list.slice(0, 50);
  }, [eligible, query]);

  const cls = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";

  return (
    <div className="relative" ref={boxRef}>
      <input type="hidden" name="ownerId" value={picked?.id ?? ""} />
      <input
        ref={inputRef}
        required
        autoComplete="off"
        className={cls}
        placeholder={team ? `Search ${team} agents…` : "Select a team first…"}
        value={picked ? picked.name : query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setPicked(null); setQuery(e.target.value); setOpen(true); }}
      />
      {picked && (
        <button
          type="button"
          onClick={() => { setPicked(null); setQuery(""); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs"
          aria-label="Clear assignment"
        >✕</button>
      )}
      {open && !picked && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-600 rounded-lg shadow-lg z-30">
          {matches.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">No active {team} agents found.</div>}
          {matches.map((u) => (
            <div
              key={u.id}
              onMouseDown={(e) => { e.preventDefault(); setPicked(u); setQuery(""); setOpen(false); }}
              className="px-3 py-2 text-sm cursor-pointer hover:bg-amber-50 dark:hover:bg-slate-700 flex items-center justify-between gap-2"
            >
              <span className="truncate">{u.name}</span>
              <span className="text-[10px] text-gray-400 flex-none">{u.team ?? (u.role === "ADMIN" ? "Admin" : "—")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

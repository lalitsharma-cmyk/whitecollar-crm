"use client";
import { useEffect, useMemo, useRef, useState } from "react";

interface ProjOption { id: string; name: string; }

// Searchable "Interested Properties" combobox for the New-Lead form. Mirrors the
// AssignToSelect picker (styled, always-visible filtered list, keyboard-navigable,
// dropdown kept within the viewport) but — unlike the agent picker — it is OPTIONAL
// and accepts a CUSTOM typed name that no project matches. It posts the resolved
// value via a hidden <input name="project">:
//   • picking a suggested project → its exact name,
//   • typing a custom name        → the typed text verbatim (the server action
//     preserves an unmatched name as the lead's sourceDetail; no forced mapping).
//
// TEAM SOURCE: RequirementSection owns Team in React state and passes the already-
// filtered `options` (that team's projects). No team selected → empty list, but the
// user can still type a custom name (the field stays usable). DRY: same look + close-
// on-outside-click + keyboard handling as AssignToSelect.
export default function ProjectSelect({
  options,
  team,
  inputClassName,
}: {
  options: ProjOption[];
  team: string;
  inputClassName?: string;
}) {
  // `value` is the resolved string actually submitted (selected OR typed custom).
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on an outside click (same UX as AssignToSelect).
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Filter the team's projects by the typed text (case-insensitive substring).
  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = q ? options.filter((p) => p.name.toLowerCase().includes(q)) : options;
    return list.slice(0, 50);
  }, [options, value]);

  // An exact (case-insensitive) match means the typed value IS a known project.
  const exact = useMemo(
    () => options.some((p) => p.name.toLowerCase() === value.trim().toLowerCase()),
    [options, value],
  );
  const showCustomHint = value.trim().length > 0 && !exact;

  useEffect(() => { setActiveIdx(0); }, [value, open]);

  const cls = inputClassName ?? "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";

  function pick(name: string) {
    setValue(name);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      // Enter selects the highlighted suggestion; if there's none (custom value),
      // just keep the typed text and close — Enter must NOT submit the form here.
      if (open && matches[activeIdx]) { e.preventDefault(); pick(matches[activeIdx].name); }
      else if (open) { e.preventDefault(); setOpen(false); }
    }
    else if (e.key === "Escape") { setOpen(false); }
  }

  return (
    <div className="relative" ref={boxRef}>
      {/* Hidden field the server action reads. Holds the resolved value (selected
          project name OR the custom typed name). */}
      <input type="hidden" name="project" value={value} />
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        className={cls}
        placeholder={team ? `Search ${team} properties or type a custom name…` : "Type a property name…"}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button
          type="button"
          onClick={() => { setValue(""); setOpen(true); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 text-xs"
          aria-label="Clear property"
        >✕</button>
      )}
      {open && (matches.length > 0 || showCustomHint) && (
        <div className="absolute left-0 right-0 top-full mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-[#e5e7eb] dark:border-slate-600 rounded-lg shadow-lg z-30">
          {matches.map((p, i) => (
            <div
              key={p.id}
              onMouseDown={(e) => { e.preventDefault(); pick(p.name); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-2 ${i === activeIdx ? "bg-amber-50 dark:bg-slate-700" : "hover:bg-amber-50 dark:hover:bg-slate-700"}`}
            >
              <span className="truncate">{p.name}</span>
            </div>
          ))}
          {/* Custom-name affordance — keeps the typed value as the Interested
              Property (saved to sourceDetail server-side when no project matches). */}
          {showCustomHint && (
            <div
              onMouseDown={(e) => { e.preventDefault(); pick(value.trim()); }}
              className="px-3 py-2 text-sm cursor-pointer border-t border-gray-100 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-slate-700"
            >
              Use &ldquo;<span className="font-medium">{value.trim()}</span>&rdquo; (custom)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

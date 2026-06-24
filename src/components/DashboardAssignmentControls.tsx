"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Time-window + team selector for the Dashboard "Live Lead Assignment" widget.
// Mirrors AgentPerfRangeSelector but writes NAMESPACED params (dwRange / dwFrom
// / dwTo / dwTeam) so it never collides with the dashboard's own ?team= /
// ?from= / ?to= (which drive the rest of the page). Preserves all other params
// on change. Thin client wrapper — all computation stays server-side.
//   - ADMIN: team seg interactive (All / Dubai / India).
//   - MANAGER: team seg locked to own team (rendered disabled).
// ─────────────────────────────────────────────────────────────────────────

const PRESETS: Array<{ value: string; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 Days" },
  { value: "thisMonth", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "last3Months", label: "Last 3 Months" },
  { value: "last6Months", label: "Last 6 Months" },
  { value: "thisYear", label: "This Year" },
  { value: "custom", label: "Custom Range" },
];

export default function DashboardAssignmentControls({
  current,
  from,
  to,
  team,
  canChooseTeam,
}: {
  current: string;
  from?: string;
  to?: string;
  team: "" | "India" | "Dubai";
  canChooseTeam: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [showCustom, setShowCustom] = useState(current === "custom");
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  function push(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    // Scroll to the widget anchor so a refresh doesn't jump to page top.
    router.push(`${pathname}?${params.toString()}#assignment-widget`, { scroll: false });
  }

  function onPreset(value: string) {
    if (value === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    push({ dwRange: value, dwFrom: null, dwTo: null });
  }

  function applyCustom() {
    if (!f || !t) return;
    push({ dwRange: "custom", dwFrom: f, dwTo: t });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mr-1">Period:</span>
        {PRESETS.map((p) => {
          const active = p.value === "custom" ? showCustom : current === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onPreset(p.value)}
              className={`chip text-[11px] min-h-7 px-2.5 ${active ? "chip-warm" : "chip-lost"}`}
            >
              {p.label}
            </button>
          );
        })}

        {/* Team filter */}
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold ml-2 mr-1">Team:</span>
        {canChooseTeam ? (
          <div className="seg">
            <button type="button" className={team === "Dubai" ? "on" : ""} onClick={() => push({ dwTeam: "Dubai" })}>🇦🇪 Dubai</button>
            <button type="button" className={team === "India" ? "on" : ""} onClick={() => push({ dwTeam: "India" })}>🇮🇳 India</button>
            <button type="button" className={team === "" ? "on" : ""} onClick={() => push({ dwTeam: null })}>All</button>
          </div>
        ) : (
          <div className="seg opacity-60 cursor-not-allowed" title="Locked to your team">
            <span className="on pointer-events-none">{team || "Your team"}</span>
          </div>
        )}
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="flex flex-col text-[11px] text-gray-500">
            From
            <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            To
            <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          </label>
          <button type="button" onClick={applyCustom} disabled={!f || !t} className="btn btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed">
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Time-window selector for the Agent Performance report.
//   - Preset chips (Today … This Year) push ?range=<preset> to the URL.
//   - "Custom Range" reveals two date inputs (IST, YYYY-MM-DD) → ?range=custom
//     &from=…&to=…  The server (resolveDateRange) reads these back.
//   - Preserves other params (team / agent) on change.
// Thin client wrapper — all metric computation stays server-side.
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

export default function AgentPerfRangeSelector({
  current,
  from,
  to,
}: {
  current: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [showCustom, setShowCustom] = useState(current === "custom");
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? "");

  function go(range: string, extra?: Record<string, string>) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("range", range);
    params.delete("from");
    params.delete("to");
    if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
    router.push(`${pathname}?${params.toString()}`);
  }

  function onPreset(value: string) {
    if (value === "custom") {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    go(value);
  }

  function applyCustom() {
    if (!f || !t) return;
    go("custom", { from: f, to: t });
  }

  return (
    <div className="card p-3 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mr-1">
          Period:
        </span>
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
      </div>

      {showCustom && (
        <div className="flex flex-wrap items-end gap-2 pt-1">
          <label className="flex flex-col text-[11px] text-gray-500">
            From
            <input
              type="date"
              value={f}
              onChange={(e) => setF(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-[11px] text-gray-500">
            To
            <input
              type="date"
              value={t}
              onChange={(e) => setT(e.target.value)}
              className="border rounded px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={applyCustom}
            disabled={!f || !t}
            className="btn btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

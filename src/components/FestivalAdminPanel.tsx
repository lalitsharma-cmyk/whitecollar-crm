"use client";

import { useEffect, useState } from "react";
import {
  FESTIVALS,
  getFestivalOverride,
  setFestivalOverride,
} from "@/lib/festivals";

/**
 * Admin-only manual override for festive mode.
 *
 * Lalit's ask (spec §12.1): be able to flip a festival theme on/off
 * outside its calendar window — for previewing, or for celebrating an
 * occasion the auto-calendar doesn't cover. Persists to localStorage so
 * the override survives reloads.
 *
 * Three modes:
 *   • "auto"        → no override, follow the date-based calendar (default)
 *   • <festival-id> → force that festival's theme + banner on
 *   • "none"        → suppress all festive theming even if a festival is live
 *
 * On change we reload the page — the simplest way to make AccentPainter
 * (which only reads `getActiveFestival()` once on mount) re-evaluate.
 */

const AUTO = "__auto__";

function formatRange(dateStr: string, daysBefore: number): string {
  const date = new Date(dateStr + "T00:00:00+05:30");
  const start = new Date(date.getTime() - daysBefore * 86_400_000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  return daysBefore > 0 ? `${fmt(start)} → ${fmt(date)}` : fmt(date);
}

export default function FestivalAdminPanel() {
  // Selected radio value: AUTO, "none", or a festival id.
  const [selected, setSelected] = useState<string>(AUTO);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const current = getFestivalOverride();
    setSelected(current ?? AUTO);
    setHydrated(true);
  }, []);

  function choose(value: string) {
    setSelected(value);
    if (value === AUTO) {
      setFestivalOverride(null);
    } else {
      setFestivalOverride(value);
    }
    // Reload so AccentPainter + FestiveBanner pick up the new state.
    window.location.reload();
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Choose <b>Auto</b> to let the calendar decide, force a specific
        festival on for previewing, or suppress all festive theming. The
        page will reload to apply the change.
      </p>

      <label
        className={`flex items-center gap-3 rounded border px-3 py-2 cursor-pointer hover:bg-gray-50 ${
          selected === AUTO ? "border-emerald-500 bg-emerald-50" : "border-gray-200"
        }`}
      >
        <input
          type="radio"
          name="festival-override"
          value={AUTO}
          checked={hydrated && selected === AUTO}
          onChange={() => choose(AUTO)}
          className="accent-emerald-600"
        />
        <span className="text-sm font-medium">Auto (follow calendar)</span>
        <span className="text-xs text-gray-500 ml-auto">default</span>
      </label>

      <div className="space-y-1.5">
        {FESTIVALS.map((f) => {
          const active = selected === f.id;
          return (
            <label
              key={f.id}
              className={`flex items-center gap-3 rounded border px-3 py-2 cursor-pointer hover:bg-gray-50 ${
                active ? "border-emerald-500 bg-emerald-50" : "border-gray-200"
              }`}
            >
              <input
                type="radio"
                name="festival-override"
                value={f.id}
                checked={hydrated && active}
                onChange={() => choose(f.id)}
                className="accent-emerald-600"
              />
              <span
                aria-hidden
                className="inline-block w-5 h-5 rounded-full border border-black/10 flex-none"
                style={{ backgroundColor: f.theme.accentHex }}
              />
              <span className="flex-1 min-w-0">
                <span className="text-sm font-medium block truncate">
                  {f.theme.emoji} {f.name}
                </span>
                <span className="text-[11px] text-gray-500 block truncate">
                  {formatRange(f.date, f.daysBefore)} · {f.theme.accentHex}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <label
        className={`flex items-center gap-3 rounded border px-3 py-2 cursor-pointer hover:bg-gray-50 ${
          selected === "none" ? "border-rose-500 bg-rose-50" : "border-gray-200"
        }`}
      >
        <input
          type="radio"
          name="festival-override"
          value="none"
          checked={hydrated && selected === "none"}
          onChange={() => choose("none")}
          className="accent-rose-600"
        />
        <span className="text-sm font-medium">🚫 Suppress all festival theming</span>
      </label>
    </div>
  );
}

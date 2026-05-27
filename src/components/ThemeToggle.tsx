"use client";
import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

/**
 * Theme switcher — Light / Dark / Auto.
 *
 * Lalit: "Set user can choose day mode or light mode."
 *
 * Three modes:
 *   • light  — explicit light theme
 *   • dark   — explicit dark theme
 *   • auto   — follows OS prefers-color-scheme (default)
 *
 * Persists to localStorage as `wcr.theme`. The inline script in
 * src/app/layout.tsx reads the same key on first paint to avoid a flash of
 * wrong theme (FOUC).
 *
 * Toggle cycles light → dark → auto → light. Icon shows the CURRENT effective
 * theme (sun for light, moon for dark, monitor for auto).
 */

type Mode = "light" | "dark" | "auto";
const KEY = "wcr.theme";

function resolveEffective(mode: Mode): "light" | "dark" {
  if (mode !== "auto") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: Mode) {
  if (typeof document === "undefined") return;
  const effective = resolveEffective(mode);
  document.documentElement.setAttribute("data-theme", effective);
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const stored = (localStorage.getItem(KEY) as Mode | null) ?? "auto";
    setMode(stored);

    // Re-apply when OS preference changes while in auto mode.
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem(KEY) as Mode | null) === "auto") applyTheme("auto"); };
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);

  function cycle() {
    const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
    setMode(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
  }

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label = mode === "light" ? "Light mode (click for Dark)"
              : mode === "dark"  ? "Dark mode (click for Auto)"
              :                    "Auto — follows OS (click for Light)";

  return (
    <button
      onClick={cycle}
      title={label}
      aria-label={label}
      className="p-2 rounded hover:bg-white/10 min-w-9 min-h-9 flex items-center justify-center text-gray-500 dark:text-gray-300"
    >
      <Icon className="w-[18px] h-[18px]" />
    </button>
  );
}

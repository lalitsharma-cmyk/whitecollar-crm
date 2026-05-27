"use client";
import { useEffect, useRef, useState } from "react";
import { Sun, Moon, Monitor, Palette } from "lucide-react";

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

/** Apply a custom accent hex globally + persist. Pass null to clear. */
function applyAccent(hex: string | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!hex) {
    root.style.removeProperty("--accent-primary");
    root.style.removeProperty("--accent-primary-2");
    root.style.removeProperty("--cta-primary");
    root.style.removeProperty("--cta-primary-2");
    localStorage.removeItem("wcr.accent");
    return;
  }
  root.style.setProperty("--accent-primary", hex);
  const shift = (h: string, amount: number) => {
    const m = h.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return h;
    const t = amount >= 0 ? 255 : 0;
    const each = (g: string) => {
      const n = parseInt(g, 16);
      const next = Math.round(n + (t - n) * Math.abs(amount));
      return Math.min(255, Math.max(0, next)).toString(16).padStart(2, "0");
    };
    return `#${each(m[1])}${each(m[2])}${each(m[3])}`;
  };
  root.style.setProperty("--accent-primary-2", shift(hex, 0.22));   // lighter for hover
  root.style.setProperty("--cta-primary", shift(hex, -0.18));        // darker for Save buttons
  root.style.setProperty("--cta-primary-2", hex);                    // hover = the base accent
  localStorage.setItem("wcr.accent", hex);
}

const PRESET_ACCENTS = [
  { name: "Brand gold",  hex: "#c9a24b" },
  { name: "Eid green",   hex: "#10b981" },
  { name: "Diwali pink", hex: "#ec4899" },
  { name: "Ocean blue",  hex: "#3b82f6" },
  { name: "Royal violet",hex: "#7c3aed" },
  { name: "Ruby red",    hex: "#dc2626" },
];

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");
  const [showAccent, setShowAccent] = useState(false);
  const [accent, setAccent] = useState<string>("");
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const stored = (localStorage.getItem(KEY) as Mode | null) ?? "auto";
    setMode(stored);
    setAccent(localStorage.getItem("wcr.accent") ?? "");

    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => { if ((localStorage.getItem(KEY) as Mode | null) === "auto") applyTheme("auto"); };
    mq?.addEventListener?.("change", onChange);
    return () => mq?.removeEventListener?.("change", onChange);
  }, []);

  // Dismiss popover on outside click
  useEffect(() => {
    if (!showAccent) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setShowAccent(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showAccent]);

  function cycle() {
    const next: Mode = mode === "light" ? "dark" : mode === "dark" ? "auto" : "light";
    setMode(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
  }

  function pickAccent(hex: string | null) {
    setAccent(hex ?? "");
    applyAccent(hex);
  }

  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label = mode === "light" ? "Light mode (click for Dark)"
              : mode === "dark"  ? "Dark mode (click for Auto)"
              :                    "Auto — follows OS (click for Light)";

  return (
    <div className="relative flex items-center" ref={popRef}>
      <button
        onClick={cycle}
        title={label}
        aria-label={label}
        className="p-2 rounded hover:bg-white/10 min-w-9 min-h-9 flex items-center justify-center text-gray-500 dark:text-gray-300"
      >
        <Icon className="w-[18px] h-[18px]" />
      </button>
      <button
        onClick={() => setShowAccent(s => !s)}
        title="Accent colour"
        aria-label="Pick accent colour"
        className="p-2 rounded hover:bg-white/10 min-w-9 min-h-9 flex items-center justify-center text-gray-500 dark:text-gray-300"
      >
        <Palette className="w-[18px] h-[18px]" />
      </button>
      {showAccent && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white text-[#0b1a33] border border-[#e5e7eb] rounded-xl shadow-2xl p-3">
          <div className="text-xs font-semibold mb-2">Accent colour</div>
          <div className="grid grid-cols-3 gap-2">
            {PRESET_ACCENTS.map(p => (
              <button
                key={p.hex}
                onClick={() => pickAccent(p.hex)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border ${accent === p.hex ? "border-[#0b1a33]" : "border-transparent hover:border-[#e5e7eb]"}`}
                title={p.name}
              >
                <span className="w-7 h-7 rounded-full border border-black/10" style={{ background: p.hex }} />
                <span className="text-[10px]">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs">
            <span className="text-gray-500">Custom:</span>
            <input
              type="color"
              value={accent || "#c9a24b"}
              onChange={(e) => pickAccent(e.target.value)}
              className="w-9 h-9 rounded cursor-pointer"
              aria-label="Custom accent colour"
            />
            <button
              onClick={() => pickAccent(null)}
              className="ml-auto text-[11px] text-gray-500 hover:text-[#0b1a33] underline"
            >Reset</button>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Auto-changes during festival weeks (Eid green now). Pick to override.
          </p>
        </div>
      )}
    </div>
  );
}

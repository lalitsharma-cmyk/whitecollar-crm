"use client";
import { useEffect } from "react";
import { getActiveFestival, resolveAccent } from "@/lib/festivals";

/**
 * Sets the global --accent-primary CSS variable based on (in priority order):
 *   1. User-picked accent in localStorage (`wcr.accent`) — either a #hex or a
 *      named preset key (gold, royal-blue, emerald, violet, rose, teal,
 *      orange, …). See resolveAccent() / ACCENT_PRESETS in src/lib/festivals.
 *   2. Active festival's accentHex (auto-applied during festival week)
 *   3. Default brand gold (#c9a24b — set in globals.css :root)
 *
 * Runs once on mount. No-op during SSR (purely visual).
 *
 * Lalit's ask: "Set user can choose day mode or light mode... festive
 * mode — Like tomorrow is EID so EID festive vibe should be on it... Add
 * all" (themes: festive Eid + Diwali auto-apply + custom accent picker).
 */
export default function AccentPainter() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    // Helper — shift a hex toward white (positive amount) or black (negative).
    // amount=0.22 → 22% lighter; amount=-0.18 → 18% darker.
    function lighten(hex: string, amount = 0.22): string {
      const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!m) return hex;
      const shift = (h: string) => {
        const n = parseInt(h, 16);
        const target = amount >= 0 ? 255 : 0;
        const next = Math.round(n + (target - n) * Math.abs(amount));
        return Math.min(255, Math.max(0, next)).toString(16).padStart(2, "0");
      };
      return `#${shift(m[1])}${shift(m[2])}${shift(m[3])}`;
    }

    function apply(hex: string | null) {
      if (!hex) {
        root.style.removeProperty("--accent-primary");
        root.style.removeProperty("--accent-primary-2");
        root.style.removeProperty("--cta-primary");
        root.style.removeProperty("--cta-primary-2");
        return;
      }
      root.style.setProperty("--accent-primary", hex);
      root.style.setProperty("--accent-primary-2", lighten(hex, 0.22));
      // CTA primary (Save buttons etc.) also follows the accent — Lalit
      // expects the whole UI's primary actions to match the festive vibe,
      // not just the gold elements. CTA is the DEEPER shade (darken 18%)
      // so white text stays readable on top.
      const darker = lighten(hex, -0.18);   // -ve = darken
      root.style.setProperty("--cta-primary", darker);
      root.style.setProperty("--cta-primary-2", hex);   // hover = the base accent
    }

    // 1) User pick wins — accepts a raw #hex OR a named preset key
    //    (e.g. "royal-blue"). resolveAccent() maps keys → hex and validates.
    const userPick = localStorage.getItem("wcr.accent");
    if (userPick) {
      const hex = resolveAccent(userPick);
      if (hex) {
        apply(hex);
        return;
      }
    }

    // 2) Festival accent (auto)
    const festival = getActiveFestival();
    if (festival && localStorage.getItem("wcr.festiveModeEnabled") !== "false") {
      apply(festival.theme.accentHex);
      return;
    }

    // 3) Default — clear overrides so globals.css :root values apply
    apply(null);
  }, []);

  return null;
}

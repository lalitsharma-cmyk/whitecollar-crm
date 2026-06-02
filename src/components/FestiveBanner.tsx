"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getActiveFestival, type Festival } from "@/lib/festivals";
import SeasonalDelight from "./SeasonalDelight";

/**
 * Auto-displays a celebratory banner when today (or the day before) matches
 * a festival in src/lib/festivals.ts. Lalit's ask: "Festive mode — Like
 * tomorrow is EID so EID festive vibe should be on it."
 *
 * Per-festival dismissal: once an agent X's the banner for a given festival,
 * they don't see it again for that occasion (localStorage). It re-appears
 * automatically for the next festival in the calendar.
 *
 * Festive mode itself can be turned off in profile/settings (separate
 * preference key `wcr.festiveModeEnabled`). Defaults to ON.
 *
 * Also mounts <SeasonalDelight/> — the floating animated decorations + the
 * interactive easter-egg. It's rendered here (rather than the shell) because
 * FestiveBanner is already mounted globally in MobileShell. SeasonalDelight
 * decides for itself whether to show (it reads getActiveFestival() too), so
 * the floating layer keeps working even after the banner strip is dismissed.
 */
const PREF_KEY = "wcr.festiveModeEnabled";
const DISMISS_PREFIX = "wcr.festiveDismissed.";

export default function FestiveBanner() {
  const [festival, setFestival] = useState<Festival | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const enabled = localStorage.getItem(PREF_KEY);
    if (enabled === "false") return;          // user muted festive mode globally

    const active = getActiveFestival();
    if (!active) return;

    // Per-festival dismissal
    const dismissed = localStorage.getItem(DISMISS_PREFIX + active.id);
    if (dismissed) return;

    setFestival(active);
    setShow(true);
  }, []);

  function dismiss() {
    if (!festival) return;
    localStorage.setItem(DISMISS_PREFIX + festival.id, "true");
    setShow(false);
  }

  return (
    <>
      {show && festival && (
        <div
          className={`relative bg-gradient-to-r ${festival.theme.gradient} ${festival.theme.textColor} px-4 py-3 shadow-md`}
          role="alert"
          aria-label={`${festival.name} greeting`}
        >
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <span className="text-2xl flex-none" aria-hidden>{festival.theme.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm sm:text-base truncate">{festival.greeting}</div>
              {festival.subline && (
                <div className="text-xs opacity-90 truncate">{festival.subline}</div>
              )}
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss greeting"
              className="flex-none p-1.5 rounded hover:bg-white/15"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating seasonal decorations + interactive easter-egg. Self-gates on
          the active festival + festive-mode preference. */}
      <SeasonalDelight />
    </>
  );
}

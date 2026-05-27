"use client";

// MissionCompleteBeacon — fires a one-shot "all daily missions complete"
// celebration from inside the server-rendered DailyMissionBoard. The board
// computes `allDone` server-side and passes it as the `fired` prop; on mount
// (or when `fired` flips to true) we dispatch the celebration exactly once
// per agent per day, guarded by a sessionStorage flag.

import { useEffect } from "react";
import { showCelebration } from "@/components/DealCelebration";

export default function MissionCompleteBeacon({ fired }: { fired: boolean }) {
  useEffect(() => {
    if (!fired) return;
    // Guard against firing twice per session by writing a daily flag.
    const key = "wcr-missions-done-" + new Date().toISOString().slice(0, 10);
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage can throw in private mode / SSR-edge cases — best effort.
    }
    showCelebration({
      kind: "all_missions_done",
      message: "All 4 daily missions complete",
    });
  }, [fired]);
  return null;
}

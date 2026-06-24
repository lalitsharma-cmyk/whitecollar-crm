"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// ─────────────────────────────────────────────────────────────────────────
// Lightweight "live" auto-refresh for the dashboard (a Server Component with
// force-dynamic, so router.refresh() re-runs the server render and streams the
// fresh widget in — no websockets infra). Pragmatic polling:
//   • Only ticks while the tab is VISIBLE (document.visibilityState), so a
//     backgrounded tab never hits the DB.
//   • On becoming visible again, refreshes immediately, then resumes the
//     interval — so returning to the tab shows current numbers at once.
//   • Default 60s; configurable. A tiny "Live" pill + last-updated time gives
//     the user feedback that it's auto-updating.
// Rendered once near the widget; it owns no data, only triggers re-render.
// ─────────────────────────────────────────────────────────────────────────

export default function DashboardLiveRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pulse, setPulse] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>(() =>
    new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
  );

  useEffect(() => {
    function doRefresh() {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setPulse(true);
      setUpdatedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }));
      setTimeout(() => setPulse(false), 800);
    }

    function start() {
      if (timer.current) return;
      timer.current = setInterval(doRefresh, intervalMs);
    }
    function stop() {
      if (timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        doRefresh(); // catch up immediately on return
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-gray-500" title={`Auto-refreshes every ${Math.round(intervalMs / 1000)}s while this tab is open`}>
      <span className={`inline-block w-2 h-2 rounded-full ${pulse ? "bg-emerald-400" : "bg-emerald-500"} ${pulse ? "" : "animate-pulse"}`} />
      Live · updated {updatedAt}
    </span>
  );
}

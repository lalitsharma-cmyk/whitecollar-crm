"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PresenceBeacon — invisible client heartbeat for the Admin Presence board.
// Mounted ONCE in the app shell (renders null). POSTs /api/presence/heartbeat:
//
//   • every 60s, ONLY while document.visibilityState === "visible" (protects
//     the serverless invocation quota — a backgrounded tab sends nothing, so
//     it naturally drifts to Offline after 90s),
//   • immediately on mount, on route change, and when the tab becomes visible
//     again (so module/route tracking stays current),
//   • active:true only when the user actually interacted (click / keydown /
//     scroll / pointerdown) since the previous beat — that drives Idle,
//   • on tab-hide: sendBeacon heartbeat with active:false,
//   • on pagehide: sendBeacon { end:true } to close the session.
//
// sessionKey lives in sessionStorage (per-tab; localStorage would merge every
// tab into one "device"). PWA detection = display-mode: standalone.
//
// PRIVACY: only the PATHNAME is ever sent (never location.search — search
// boxes can contain client phone numbers); the server strips again anyway.
// Every code path is wrapped — a presence failure must NEVER break the CRM.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const ENDPOINT = "/api/presence/heartbeat";
const HEARTBEAT_MS = 60_000; // keep in sync with HEARTBEAT_INTERVAL_MS in src/lib/presence.ts
const STORAGE_KEY = "wcr_presence_key";

let memoryKey: string | null = null; // fallback when sessionStorage is unavailable

function getSessionKey(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const fresh =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    if (!memoryKey) memoryKey = `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    return memoryKey;
  }
}

function isPwa(): boolean {
  try {
    if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) return true;
    // iOS Safari home-screen apps expose navigator.standalone instead.
    return (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** Tiny client hint only — the server re-parses the User-Agent header itself. */
function clientDevice(): { os: string; browser: string; isPwa: boolean } {
  let os = "Other";
  let browser = "Other";
  try {
    const ua = navigator.userAgent;
    if (/iPad/i.test(ua)) os = "iPadOS";
    else if (/iPhone|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Windows/i.test(ua)) os = "Windows";
    else if (/Macintosh/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";
    if (/EdgiOS|EdgA|Edg\//i.test(ua)) browser = "Edge";
    else if (/FxiOS|Firefox\//i.test(ua)) browser = "Firefox";
    else if (/CriOS|Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Safari\//i.test(ua)) browser = "Safari";
  } catch { /* hints only */ }
  return { os, browser, isPwa: isPwa() };
}

export function PresenceBeacon() {
  const pathname = usePathname();
  const activeRef = useRef(false);     // any real interaction since the last beat?
  const lastSentRef = useRef(0);       // throttle guard for burst navigations

  // Payload built fresh each send; pathname ONLY, never the query string.
  const buildBody = (active: boolean, end?: boolean): string => {
    const path = (() => {
      try { return window.location.pathname || "/"; } catch { return "/"; }
    })();
    return JSON.stringify({
      sessionKey: getSessionKey(),
      route: path,
      device: clientDevice(),
      active,
      ...(end ? { end: true } : {}),
    });
  };

  const send = (active: boolean, opts?: { beacon?: boolean; end?: boolean }) => {
    try {
      const body = buildBody(active, opts?.end);
      lastSentRef.current = Date.now();
      if (opts?.beacon && typeof navigator.sendBeacon === "function") {
        // Blob keeps the JSON content-type so the server parses it the same way.
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch { /* presence must never break the app */ }
  };

  // ── Heartbeat loop + lifecycle listeners (mounted once) ──
  useEffect(() => {
    try {
      const onActivity = () => { activeRef.current = true; };
      // Cheap flag-set (the throttle IS the flag) — capture phase so nothing
      // that stops propagation can hide activity.
      window.addEventListener("click", onActivity, true);
      window.addEventListener("keydown", onActivity, true);
      window.addEventListener("scroll", onActivity, { capture: true, passive: true });
      window.addEventListener("pointerdown", onActivity, true);

      const iv = setInterval(() => {
        try {
          if (document.visibilityState !== "visible") return; // quota guard
          const wasActive = activeRef.current;
          activeRef.current = false;
          send(wasActive);
        } catch { /* never throw from the interval */ }
      }, HEARTBEAT_MS);

      const onVisibility = () => {
        try {
          if (document.visibilityState === "hidden") {
            // Last word before backgrounding — beacon survives tab switches.
            activeRef.current = false;
            send(false, { beacon: true });
          } else if (document.visibilityState === "visible") {
            // Coming back to the CRM is a real interaction — refresh instantly.
            send(true);
          }
        } catch { /* ignore */ }
      };
      const onPageHide = () => {
        try { send(false, { beacon: true, end: true }); } catch { /* ignore */ }
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);

      return () => {
        clearInterval(iv);
        window.removeEventListener("click", onActivity, true);
        window.removeEventListener("keydown", onActivity, true);
        window.removeEventListener("scroll", onActivity, { capture: true } as EventListenerOptions);
        window.removeEventListener("pointerdown", onActivity, true);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
      };
    } catch {
      return; // even a broken setup must not break the shell
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Route change (and initial mount) → immediate beat so the admin board
  // shows the module the user is in right now. Navigating IS activity.
  // Tiny 2s guard absorbs redirect chains (each beat is one cheap upsert).
  useEffect(() => {
    try {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSentRef.current < 2_000) return;
      send(true);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null; // zero UI
}

export default PresenceBeacon;

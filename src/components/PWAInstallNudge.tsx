"use client";
import { useEffect, useState } from "react";

/**
 * The browser's `beforeinstallprompt` event isn't part of the standard
 * DOM lib types yet, so we declare the shape we use.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "wcr-pwa-nudge-dismissed";
const DISMISS_WINDOW_DAYS = 30;

/** Was the nudge dismissed within the last 30 days? */
function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const then = new Date(raw);
    if (Number.isNaN(then.getTime())) return false;
    const diffMs = Date.now() - then.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays < DISMISS_WINDOW_DAYS;
  } catch {
    return false;
  }
}

/**
 * One-time mobile nudge to install the CRM as a PWA. Listens for the
 * `beforeinstallprompt` browser event, captures it, and shows a custom
 * banner just above the mobile bottom nav. Silently does nothing on iOS
 * Safari (which never fires the event) and on desktop viewports.
 */
export default function PWAInstallNudge() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Hard guards — only run on mobile, only if not already installed,
    // and only if the user hasn't dismissed recently.
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (recentlyDismissed()) return;

    function onBeforeInstall(e: Event) {
      // Stop the browser's mini-infobar so we can show our own UI.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      localStorage.setItem(DISMISS_KEY, today);
    } catch {
      // localStorage can throw in private mode — best-effort.
    }
    setVisible(false);
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setVisible(false);
      } else {
        // User declined the native prompt — treat as a dismissal so we
        // don't immediately ask again.
        dismiss();
      }
    } catch {
      dismiss();
    } finally {
      setDeferred(null);
    }
  }

  if (!visible || !deferred) return null;

  return (
    <div
      className="lg:hidden fixed left-0 right-0 z-40 px-3 pwa-nudge-slide-up"
      style={{
        // Sit just above the 4rem mobile bottom nav + the iPhone home indicator.
        bottom: "calc(4rem + env(safe-area-inset-bottom))",
      }}
      role="dialog"
      aria-label="Install White Collar CRM"
    >
      <div className="mx-auto max-w-md bg-[#0b1a33] text-white border-2 border-[#c9a24b] rounded-xl shadow-2xl px-4 py-3 flex items-start gap-3">
        <div className="flex-1 text-sm leading-snug">
          <span aria-hidden="true">📱</span>{" "}
          Install White Collar CRM as an app for faster access + push notifications
        </div>
        <div className="flex flex-col gap-2 items-stretch">
          <button
            type="button"
            onClick={install}
            className="text-xs font-bold bg-[#c9a24b] text-[#0b1a33] px-3 py-1.5 rounded-md hover:brightness-110 transition"
          >
            Install
          </button>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="text-white/70 hover:text-white p-1 -mt-1 -mr-1"
        >
          ✕
        </button>
      </div>
      <style jsx>{`
        @keyframes pwa-nudge-slide-up {
          from {
            opacity: 0;
            transform: translateY(120%);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .pwa-nudge-slide-up {
          animation: pwa-nudge-slide-up 320ms ease-out both;
        }
      `}</style>
    </div>
  );
}

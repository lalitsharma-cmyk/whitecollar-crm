"use client";
import { useEffect, useState } from "react";
import { getPushState, enablePush, ensureSubscribedIfGranted, type PushState } from "@/lib/pushClient";
import { setChosenSound, setChosenVolume, type NotifSoundId, type VolumeLevel } from "@/lib/notifSounds";

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function PWARegister() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pushState, setPushState] = useState<PushState>("default");
  const [pushResolved, setPushResolved] = useState(false); // true once getPushState() has actually run
  const [pushDismissed, setPushDismissed] = useState(false);
  const [enabling, setEnabling] = useState(false);

  // Register SW (always, in production)
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const t = setTimeout(() => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, []);

  // ── Notification bootstrap (runs on every app load) ─────────────────────────
  //  • Auto-heal push: if permission was granted but the subscription is missing
  //    (the old bug that left 0 devices subscribed), silently re-subscribe.
  //  • Detect the real push state so we only show the banner when truly needed.
  //  • Sync the user's chosen alert sound + volume from the server into
  //    localStorage so NotifBell plays the right sound on THIS device.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let alive = true;
    (async () => {
      await ensureSubscribedIfGranted();
      const s = await getPushState();
      if (alive) { setPushState(s); setPushResolved(true); }
      // Durable suppressor: once truly enabled on this device, never auto-prompt again.
      try { if (s === "enabled") localStorage.setItem("wcr-push-dismissed", "1"); } catch {}
      try {
        const r = await fetch("/api/me/notif-settings", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (j?.sound) setChosenSound(j.sound as NotifSoundId);
          if (j?.volume) setChosenVolume(j.volume as VolumeLevel);
        }
      } catch {}
    })();
    try { if (localStorage.getItem("wcr-push-dismissed")) setPushDismissed(true); } catch {}
    return () => { alive = false; };
  }, []);

  // ── Auto-recover from STALE-CHUNK errors (unchanged) ────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "wcr-chunk-heal-count";
    const isChunkError = (m: string) =>
      /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(m);
    let healing = false;
    async function heal() {
      if (healing) return;
      let count = 0;
      try { count = Number(sessionStorage.getItem(KEY) || "0"); } catch {}
      if (count >= 2) return;
      healing = true;
      try { sessionStorage.setItem(KEY, String(count + 1)); } catch {}
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        if (typeof caches !== "undefined") {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch {}
      window.location.reload();
    }
    const onError = (e: ErrorEvent) => { if (e?.message && isChunkError(e.message)) heal(); };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e?.reason;
      const m = (r && (r.message || r.name || String(r))) || "";
      if (isChunkError(m)) heal();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const clear = setTimeout(() => { try { sessionStorage.removeItem(KEY); } catch {} }, 20000);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearTimeout(clear);
    };
  }, []);

  // Capture install prompt + detect installed (unchanged)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as DeferredPrompt); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia?.("(display-mode: standalone)").matches) setInstalled(true);
    if (
      (typeof localStorage !== "undefined" && localStorage.getItem("wcr-install-dismissed"))
      || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("wcr-install-dismissed"))
    ) setHidden(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function onEnablePush() {
    setEnabling(true);
    try {
      const s = await enablePush();
      setPushState(s);
      try { if (s === "enabled") localStorage.setItem("wcr-push-dismissed", "1"); } catch {}
    } finally { setEnabling(false); }
  }

  // ── PUSH ENABLE BANNER — shows on ANY browser (laptop included), not gated
  //    behind installing the PWA. Only while permission is still "default" and
  //    the user hasn't dismissed it. Once granted/subscribed → never shows again. ──
  // Only after we KNOW the real state (pushResolved), only when permission was
  // never asked ("default"), and only if not durably dismissed/enabled. Prevents
  // the first-paint flash AND the "re-asks even though already enabled" loop.
  const showPushBanner = pushResolved && pushState === "default" && !pushDismissed && !hidden;
  if (showPushBanner) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-xs bg-white dark:bg-slate-800 border border-[#c9a24b] shadow-2xl rounded-xl p-4">
        <div className="font-bold text-[#0b1a33] dark:text-slate-100">🔔 Turn on lead alerts</div>
        <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">Get a loud sound + notification the instant a new lead arrives — even when this tab is in the background.</p>
        <div className="flex gap-2 mt-3">
          <button onClick={onEnablePush} disabled={enabling} className="btn btn-gold text-xs disabled:opacity-50">{enabling ? "Enabling…" : "Enable"}</button>
          <button onClick={() => { try { localStorage.setItem("wcr-push-dismissed", "1"); } catch {}; setPushDismissed(true); }} className="btn btn-ghost text-xs">Not now</button>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Manage anytime in <b>Notifications → Alerts</b>.</p>
      </div>
    );
  }

  // ── INSTALL banner (PWA add-to-home-screen) — unchanged behaviour ───────────
  if (installed || hidden) return null;
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferred && !isIOS) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs bg-white dark:bg-slate-800 border border-[#c9a24b] shadow-2xl rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#0b1a33] flex items-center justify-center text-[#c9a24b] font-extrabold">W</div>
        <div className="flex-1 text-sm">
          <div className="font-bold text-[#0b1a33] dark:text-slate-100">Install on your phone</div>
          {deferred ? (
            <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">One tap to add the CRM to your home screen. Includes push notifications.</p>
          ) : (
            <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">Tap the <b>Share</b> icon in Safari, then choose <b>&quot;Add to Home Screen&quot;</b>. Required for push on iOS.</p>
          )}
          <div className="flex gap-2 mt-3">
            {deferred && (
              <button
                onClick={async () => {
                  await deferred.prompt();
                  const r = await deferred.userChoice;
                  if (r.outcome === "accepted") { setInstalled(true); await onEnablePush(); }
                  setDeferred(null);
                }}
                className="btn btn-gold text-xs"
              >Install</button>
            )}
            <button
              onClick={() => { try { localStorage.setItem("wcr-install-dismissed", "1"); } catch {}; setHidden(true); }}
              className="btn btn-ghost text-xs"
            >Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

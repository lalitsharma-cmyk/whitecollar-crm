"use client";
import { useEffect, useState } from "react";

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const VAPID_PUB = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlB64ToUint8(base64: string): ArrayBuffer {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const s = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

async function registerSWAndPush(): Promise<"granted" | "denied" | "default" | "unsupported" | "no-vapid"> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const reg = await navigator.serviceWorker.register("/sw.js");
  if (!("PushManager" in window)) return "unsupported";
  if (!VAPID_PUB) return "no-vapid";

  const existing = await reg.pushManager.getSubscription();
  if (existing) return "granted";

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlB64ToUint8(VAPID_PUB),
  });
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return "granted";
}

export default function PWARegister() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pushStatus, setPushStatus] = useState<string>("");

  // Register SW (always, in production)
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const t = setTimeout(() => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, []);

  // ── Auto-recover from STALE-CHUNK errors ───────────────────────────────────
  // After a deploy, the chunk hashes change. If a browser (or a service worker)
  // is holding an old page/chunk, a route's JS/CSS fails to load with a
  // "ChunkLoadError" / "Loading chunk failed" — the page shows the error boundary
  // and a plain hard-refresh doesn't fix it (the SW keeps serving stale bytes).
  // This catches those errors, purges the SW + caches, and reloads ONCE so the
  // browser self-heals. Capped at 2 attempts/session to never loop.
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
      if (count >= 2) return; // already tried — stop so we never loop
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
    // App stayed up for a while → clear the attempt counter so a LATER deploy can
    // heal again on a fresh session.
    const clear = setTimeout(() => { try { sessionStorage.removeItem(KEY); } catch {} }, 20000);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      clearTimeout(clear);
    };
  }, []);

  // Capture install prompt + detect installed
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as DeferredPrompt); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia?.("(display-mode: standalone)").matches) setInstalled(true);
    // Persistent dismiss — used to be sessionStorage which came back on
    // every reopen. localStorage stays until the user explicitly resets.
    if (
      (typeof localStorage !== "undefined" && localStorage.getItem("wcr-install-dismissed"))
      || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("wcr-install-dismissed"))
    ) setHidden(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function enablePush() {
    setPushStatus("requesting…");
    const r = await registerSWAndPush();
    setPushStatus(r);
    // Persist success so we never re-prompt on future visits, even across
    // device restarts. sessionStorage (old behaviour) cleared on close →
    // Lalit reported "If push alerts is enabled once, it keeps on asking
    // again and again for it." Same flag also written on permission denial
    // so we don't pester after a "no".
    if (r === "granted" || r === "denied") {
      try { localStorage.setItem("wcr-push-prompted", r); } catch {}
    }
  }

  if (installed && !pushStatus) {
    // Already installed — offer push opt-in if not yet asked or dismissed
    const everPrompted = (typeof localStorage !== "undefined" && localStorage.getItem("wcr-push-prompted"))
                      || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("wcr-push-dismissed"))
                      || (typeof localStorage !== "undefined" && localStorage.getItem("wcr-push-dismissed"));
    const browserPerm = typeof Notification !== "undefined" ? Notification.permission : "denied";
    // Skip the banner if:
    //   • Browser already says granted or denied (we have an answer)
    //   • User previously dismissed (persisted in localStorage now, not session)
    //   • We've previously prompted and got an answer
    if (browserPerm === "default" && !everPrompted) {
      return (
        <div className="fixed bottom-4 right-4 z-50 max-w-xs bg-white border border-[#c9a24b] shadow-2xl rounded-xl p-4">
          <div className="font-bold text-[#0b1a33]">Get push alerts</div>
          <p className="text-xs text-gray-600 mt-1">New leads, SLA reminders, follow-ups — pushed to your phone home screen.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={enablePush} className="btn btn-gold text-xs">Enable</button>
            <button onClick={() => { try { localStorage.setItem("wcr-push-dismissed", "1"); } catch {}; setHidden(true); }} className="btn btn-ghost text-xs">Not now</button>
          </div>
        </div>
      );
    }
    return null;
  }
  if (installed || hidden) return null;

  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferred && !isIOS) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs bg-white border border-[#c9a24b] shadow-2xl rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#0b1a33] flex items-center justify-center text-[#c9a24b] font-extrabold">W</div>
        <div className="flex-1 text-sm">
          <div className="font-bold text-[#0b1a33]">Install on your phone</div>
          {deferred ? (
            <p className="text-xs text-gray-600 mt-1">One tap to add the CRM to your home screen. Includes push notifications.</p>
          ) : (
            <p className="text-xs text-gray-600 mt-1">Tap the <b>Share</b> icon in Safari, then choose <b>"Add to Home Screen"</b>. Required for push on iOS.</p>
          )}
          <div className="flex gap-2 mt-3">
            {deferred && (
              <button
                onClick={async () => {
                  await deferred.prompt();
                  const r = await deferred.userChoice;
                  if (r.outcome === "accepted") {
                    setInstalled(true);
                    await enablePush();
                  }
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

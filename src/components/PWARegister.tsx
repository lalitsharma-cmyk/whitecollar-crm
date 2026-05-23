"use client";
import { useEffect, useState } from "react";

type DeferredPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function PWARegister() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Register the service worker (production only — dev SW is noisy)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    const t = setTimeout(() => { navigator.serviceWorker.register("/sw.js").catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, []);

  // Capture install prompt (Android/Desktop) and detect already-installed
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as DeferredPrompt); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Detect launched-as-PWA
    if (window.matchMedia?.("(display-mode: standalone)").matches) setInstalled(true);
    // Dismiss memory
    if (sessionStorage.getItem("wcr-install-dismissed")) setHidden(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || hidden) return null;

  // iOS doesn't fire beforeinstallprompt — show an iOS-specific tip if applicable
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferred && !isIOS) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs bg-white border border-[#c9a24b] shadow-2xl rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#0b1a33] flex items-center justify-center text-[#c9a24b] font-extrabold">W</div>
        <div className="flex-1 text-sm">
          <div className="font-bold text-[#0b1a33]">Install on your phone</div>
          {deferred ? (
            <p className="text-xs text-gray-600 mt-1">One tap to add the CRM to your home screen.</p>
          ) : (
            <p className="text-xs text-gray-600 mt-1">Tap the <b>Share</b> icon at the bottom of Safari, then choose <b>"Add to Home Screen"</b>.</p>
          )}
          <div className="flex gap-2 mt-3">
            {deferred && (
              <button
                onClick={async () => { await deferred.prompt(); const r = await deferred.userChoice; if (r.outcome === "accepted") setInstalled(true); setDeferred(null); }}
                className="btn btn-gold text-xs"
              >Install</button>
            )}
            <button
              onClick={() => { sessionStorage.setItem("wcr-install-dismissed", "1"); setHidden(true); }}
              className="btn btn-ghost text-xs"
            >Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

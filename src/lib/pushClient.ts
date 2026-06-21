"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Client-side Web Push enable + detection — the SINGLE source of truth shared by
// the enable banner (PWARegister) and the Notification Settings card.
//
// Fixes Lalit's bug "Enable Notifications keeps re-asking / behaves as disabled":
//   • Works on a plain LAPTOP browser — NOT gated behind installing the PWA
//     (that gate is why 0 devices were ever subscribed).
//   • "enabled" = permission granted AND a push subscription exists on this
//     device. We never re-prompt once that's true.
//   • If permission was granted before but the subscription is missing (the old
//     failure mode), we silently re-subscribe instead of nagging.
// ─────────────────────────────────────────────────────────────────────────────

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

export type PushState =
  | "unsupported"            // browser has no SW/Push/Notification
  | "ios-needs-install"      // iPhone/iPad in Safari — must Add to Home Screen first
  | "no-vapid"               // server keys not exposed to the client
  | "default"                // never asked — show the Enable button
  | "denied"                 // user blocked — must un-block in browser settings
  | "granted-unsubscribed"   // permission ok but no subscription saved (auto-heal)
  | "enabled";               // permission granted + subscription on file

function supported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

// iOS only exposes Web Push inside an INSTALLED PWA (Add to Home Screen, iOS 16.4+).
// In a normal Safari tab PushManager is absent, so `supported()` is false — detect
// that case so the UI can say "install first" instead of a dead "not supported".
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS masquerades as Mac
}
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported";
  if (!VAPID_PUB) return "no-vapid";
  const perm = Notification.permission;
  if (perm === "denied") return "denied";
  if (perm === "default") return "default";
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    const sub = await reg.pushManager.getSubscription();
    return sub ? "enabled" : "granted-unsubscribed";
  } catch {
    return "granted-unsubscribed";
  }
}

/** Request permission (if needed) → register SW → subscribe → persist to server. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported";
  if (!VAPID_PUB) return "no-vapid";
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "default";

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUB) });
  }
  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch { /* network — retried on next visit by ensureSubscribedIfGranted */ }
  try { localStorage.setItem("wcr-push-prompted", "granted"); } catch {}
  return "enabled";
}

/** Auto-heal: if permission is already granted but no subscription is saved on
 *  this device, silently (re)subscribe. Safe to call on every app load. */
export async function ensureSubscribedIfGranted(): Promise<void> {
  try {
    if (!supported() || !VAPID_PUB) return;
    if (Notification.permission !== "granted") return;
    const state = await getPushState();
    if (state === "granted-unsubscribed") await enablePush();
  } catch { /* never throw on a background heal */ }
}

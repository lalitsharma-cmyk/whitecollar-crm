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

// Return a Uint8Array (not a bare ArrayBuffer) — some iOS Safari builds reject an
// ArrayBuffer as applicationServerKey, which silently fails the subscribe().
function urlB64ToUint8(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const s = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s);
  const view = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}

// Best-effort diagnostic capture (Lalit asked for iPhone debug logs). Fire-and-
// forget to /api/push/debug → stored in the audit log so we can see exactly what
// each device reports (permission, subscription, iOS/standalone, UA, errors).
function reportDiag(context: string, fields: Record<string, unknown>): void {
  try {
    const payload = {
      context,
      permission: typeof Notification !== "undefined" ? Notification.permission : "n/a",
      supported: supported(),
      ios: isIOS(),
      standalone: isStandalone(),
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      ...fields,
    };
    fetch("/api/push/debug", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch { /* diagnostics must never break the flow */ }
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

// Persist the live subscription to the server; returns true only if the row saved.
// Idempotent (server upserts by endpoint) so it's safe to call on every load —
// this is what heals the "device thinks it's enabled but the server has 0 rows"
// case (a POST that silently failed once would otherwise never be retried).
async function persistSubscription(sub: PushSubscription): Promise<boolean> {
  try {
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Request permission (if needed) → register SW → subscribe → persist to server.
 *  Only returns "enabled" when the server actually SAVED the subscription. */
export async function enablePush(): Promise<PushState> {
  if (!supported()) {
    const st: PushState = isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported";
    reportDiag("enable", { result: st });
    return st;
  }
  if (!VAPID_PUB) { reportDiag("enable", { result: "no-vapid" }); return "no-vapid"; }
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      const st: PushState = perm === "denied" ? "denied" : "default";
      reportDiag("enable", { result: st, permission: perm });
      return st;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUB) as BufferSource });
    }
    const saved = await persistSubscription(sub);
    try { localStorage.setItem("wcr-push-prompted", "granted"); } catch {}
    // "enabled" ONLY when the server confirmed the save — otherwise the next load's
    // heal will retry the POST (the local sub already exists).
    reportDiag("enable", { result: saved ? "enabled" : "granted-unsubscribed", permission: "granted", hasSub: true, saved });
    return saved ? "enabled" : "granted-unsubscribed";
  } catch (e) {
    reportDiag("enable", { result: "error", error: String((e as Error)?.message ?? e) });
    return "granted-unsubscribed";
  }
}

/** Auto-heal on every app load: if permission is granted, make sure a local
 *  subscription EXISTS and is PERSISTED on the server (re-POST every time, so a
 *  prior failed save is repaired). Never throws. */
export async function ensureSubscribedIfGranted(): Promise<void> {
  try {
    if (!supported() || !VAPID_PUB) return;
    if (Notification.permission !== "granted") return;
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(VAPID_PUB) as BufferSource }).catch(() => null);
    }
    if (sub) {
      const saved = await persistSubscription(sub); // ALWAYS re-persist (idempotent heal)
      if (!saved) reportDiag("heal", { result: "save-failed", hasSub: true });
    } else {
      reportDiag("heal", { result: "subscribe-failed" });
    }
  } catch { /* never throw on a background heal */ }
}

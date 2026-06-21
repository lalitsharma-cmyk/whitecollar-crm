"use client";
import { useEffect, useState } from "react";
import { Bell, Play, Volume2, Check, BellRing, AlertTriangle } from "lucide-react";
import {
  NOTIF_SOUNDS, VOLUME_LEVELS, type NotifSoundId, type VolumeLevel,
  getChosenSound, getChosenVolume, setChosenSound, setChosenVolume,
  previewSound, playSound, isNotifSoundEnabled, setNotifSoundEnabled,
} from "@/lib/notifSounds";
import { getPushState, enablePush, type PushState } from "@/lib/pushClient";

export default function NotificationSettingsCard() {
  const [sound, setSound] = useState<NotifSoundId>("premium");
  const [volume, setVolume] = useState<VolumeLevel>("high");
  const [soundOn, setSoundOn] = useState(true);
  const [push, setPush] = useState<PushState>("default");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Load: server is source of truth → mirror into localStorage so the engine reads it.
  useEffect(() => {
    setSoundOn(isNotifSoundEnabled());
    setSound(getChosenSound());
    setVolume(getChosenVolume());
    getPushState().then(setPush).catch(() => {});
    fetch("/api/me/notif-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (j.sound) { setChosenSound(j.sound); setSound(j.sound); }
        if (j.volume) { setChosenVolume(j.volume); setVolume(j.volume); }
      })
      .catch(() => {});
  }, []);

  async function save(next: { sound?: NotifSoundId; volume?: VolumeLevel }) {
    try {
      await fetch("/api/me/notif-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
    } catch {}
  }

  function pickSound(id: NotifSoundId) {
    setSound(id); setChosenSound(id); previewSound(id); void save({ sound: id });
  }
  function pickVolume(level: VolumeLevel) {
    setVolume(level); setChosenVolume(level); playSound(sound, level); void save({ volume: level });
  }
  function toggleMute() {
    const next = !soundOn; setSoundOn(next); setNotifSoundEnabled(next); if (next) playSound(sound, volume);
  }

  async function onEnable() {
    setBusy(true); setMsg("");
    try {
      const s = await enablePush();
      setPush(s);
      setMsg(
        s === "enabled" ? "✅ Notifications enabled on this device."
        : s === "denied" ? "⛔ Blocked in your browser. Click the lock icon in the address bar → allow Notifications, then retry."
        : s === "no-vapid" ? "Push isn't configured on the server."
        : s === "ios-needs-install" ? "📲 On iPhone/iPad: tap the Share icon → “Add to Home Screen”, open the CRM from that new icon, then tap Enable here. iOS only delivers background notifications to the installed app."
        : s === "unsupported" ? "This browser doesn't support push notifications."
        : "Couldn't enable — please try again."
      );
    } finally { setBusy(false); }
  }

  async function onTest() {
    setBusy(true); setMsg("");
    // Always play the in-app sound (covers the tab-open case + verifies volume).
    playSound(sound, volume);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setMsg(
        j.devices === 0 ? "🔊 Sound played. No push device yet — press “Enable notifications” above to also get alerts when this tab is closed."
        : j.sent > 0 ? `✅ Test sent to ${j.sent} device${j.sent === 1 ? "" : "s"} + sound played here.`
        : j.reason === "push-not-configured" ? "🔊 Sound played (server push not configured)."
        : "🔊 Sound played. Push delivery pending."
      );
    } catch {
      setMsg("🔊 Sound played (couldn't reach the server for push).");
    } finally { setBusy(false); }
  }

  const pushBadge =
    push === "enabled" ? { text: "Enabled", cls: "bg-green-100 text-green-800 border-green-300" }
    : push === "denied" ? { text: "Blocked in browser", cls: "bg-red-100 text-red-700 border-red-300" }
    : push === "granted-unsubscribed" ? { text: "Finishing setup…", cls: "bg-amber-100 text-amber-800 border-amber-300" }
    : push === "ios-needs-install" ? { text: "Add to Home Screen first", cls: "bg-amber-100 text-amber-800 border-amber-300" }
    : push === "unsupported" ? { text: "Not supported here", cls: "bg-slate-100 text-slate-500 border-slate-300" }
    : push === "no-vapid" ? { text: "Server not configured", cls: "bg-slate-100 text-slate-500 border-slate-300" }
    : { text: "Not enabled", cls: "bg-slate-100 text-slate-600 border-slate-300" };

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <BellRing className="w-5 h-5 text-[#0b1a33] dark:text-blue-300" />
        <h2 className="font-semibold text-[#0b1a33] dark:text-slate-100">Notification alerts</h2>
        <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full border ${pushBadge.cls}`}>{pushBadge.text}</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400 -mt-2">
        Get a loud alert + push the moment a new lead arrives — even when this tab is minimised or you're in another app.
      </p>

      {/* iPhone/iPad: must install to Home Screen before push can be enabled. */}
      {push === "ios-needs-install" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div className="font-semibold">📲 iPhone / iPad — one-time setup</div>
          <div>1. Tap the <strong>Share</strong> icon (□↑) in Safari.</div>
          <div>2. Choose <strong>“Add to Home Screen”</strong>.</div>
          <div>3. Open the CRM from the <strong>new home-screen icon</strong> (not Safari).</div>
          <div>4. Come back to this screen and tap <strong>Enable</strong>.</div>
          <div className="text-amber-700/80 dark:text-amber-300/70 pt-0.5">iOS only delivers background notifications to the installed app.</div>
        </div>
      )}

      {/* Enable push */}
      {push !== "enabled" && (
        <button onClick={onEnable} disabled={busy || push === "unsupported" || push === "no-vapid" || push === "ios-needs-install"}
          className="btn btn-gold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          <Bell className="w-4 h-4" /> Enable notifications on this device
        </button>
      )}
      {push === "enabled" && (
        <div className="text-sm text-green-700 dark:text-green-400 inline-flex items-center gap-1.5">
          <Check className="w-4 h-4" /> Push notifications are enabled on this device.
        </div>
      )}

      {/* Sound picker */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Alert sound</label>
          <button onClick={toggleMute} className="text-[11px] text-gray-500 hover:text-[#0b1a33] inline-flex items-center gap-1">
            <Volume2 className="w-3.5 h-3.5" /> {soundOn ? "Sound on" : "Muted"}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NOTIF_SOUNDS.map((s) => (
            <button key={s.id} onClick={() => pickSound(s.id)}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm ${sound === s.id ? "border-[#c9a24b] bg-amber-50 dark:bg-slate-800 font-semibold text-[#0b1a33] dark:text-blue-200" : "border-gray-200 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:border-gray-400"}`}>
              <span className="inline-flex items-center gap-1.5">{sound === s.id && <Check className="w-3.5 h-3.5 text-[#c9a24b]" />}{s.label}</span>
              <Play className="w-3.5 h-3.5 opacity-60" />
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Tap a sound to preview + select it.</p>
      </div>

      {/* Volume */}
      <div>
        <label className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-1.5 block">Volume</label>
        <div className="flex gap-1.5">
          {VOLUME_LEVELS.map((v) => (
            <button key={v.id} onClick={() => pickVolume(v.id)}
              className={`flex-1 px-2 py-1.5 rounded-lg border text-xs font-medium ${volume === v.id ? "border-[#0b1a33] bg-[#0b1a33] text-white dark:border-blue-500 dark:bg-blue-700" : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300 hover:border-gray-400"}`}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Test */}
      <div className="pt-1">
        <button onClick={onTest} disabled={busy} className="btn btn-ghost text-sm inline-flex items-center gap-2 border border-gray-200 dark:border-slate-600 disabled:opacity-50">
          <AlertTriangle className="w-4 h-4" /> Send test notification
        </button>
        {msg && <div className="text-xs text-gray-600 dark:text-slate-300 mt-2">{msg}</div>}
      </div>
    </div>
  );
}

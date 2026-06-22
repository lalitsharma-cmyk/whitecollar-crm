"use client";
import { useEffect, useRef, useState } from "react";

// Per-user notification preferences editor.
// Each row is a labelled switch; toggling it queues a debounced PATCH to
// /api/me/notif-prefs (500ms) so a flurry of clicks collapses to one write.
//
// `sound` is the in-app sound-effect toggle (separate from notification kinds).
// All other keys map to notification kinds the cron jobs / push pipeline will
// later respect when deciding whether to ping a given user.

type Prefs = Record<string, boolean>;

interface Option { key: string; label: string; }

const OPTIONS: Option[] = [
  { key: "hot_lead",     label: "🔥 Hot lead alerts" },
  { key: "followup",     label: "📅 Follow-up reminders" },
  { key: "sla",          label: "⚠ SLA breach warnings" },
  { key: "daily_report", label: "📊 Daily summary emails" },
  { key: "meeting",      label: "🏢 Meeting reminders" },
  { key: "cold_promote", label: "🎯 Cold-to-warm celebrations" },
  { key: "mood_checkin", label: "🧘 Mood check-in nudges" },
  { key: "team_feed",    label: "📡 Team activity feed" },
  { key: "sound",        label: "🔊 In-app sound effects" },
];

interface Props { initialPrefs: Prefs; }

export default function NotifPrefsEditor({ initialPrefs }: Props) {
  // Default any missing key to ON — first-time users have no prefs row yet.
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const seed: Prefs = {};
    for (const o of OPTIONS) seed[o.key] = initialPrefs[o.key] !== false;
    return seed;
  });

  // `sound` is device-local (the bell stores it in localStorage). On mount,
  // prefer that value over the server seed so the toggle matches what the bell
  // is actually doing on THIS device. Runs once, client-side only.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const v = localStorage.getItem("wcr.notifSoundEnabled");
    if (v === "true" || v === "false") {
      setPrefs((p) => (p.sound === (v === "true") ? p : { ...p, sound: v === "true" }));
    }
  }, []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Prefs>(prefs);

  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);

  // Cleanup pending timer on unmount.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // The NotifBell owns in-app sound via localStorage key "wcr.notifSoundEnabled"
  // (see src/lib/notifSounds.ts). Mirror the Settings "sound" toggle into that
  // SAME key so the two controls stay consistent on this device — otherwise the
  // Settings toggle would be a no-op while the bell kept its own state.
  function toggle(key: string) {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      if (key === "sound" && typeof localStorage !== "undefined") {
        localStorage.setItem("wcr.notifSoundEnabled", next.sound ? "true" : "false");
      }
      return next;
    });
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(save, 500);
  }

  async function save() {
    try {
      const r = await fetch("/api/me/notif-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: latest.current }),
      });
      if (r.ok) {
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {OPTIONS.map((o) => {
          const on = prefs[o.key];
          return (
            <label
              key={o.key}
              className="flex items-center justify-between gap-3 p-2.5 border border-gray-200 rounded cursor-pointer hover:bg-gray-50"
            >
              <span className="text-sm">{o.label}</span>
              {/* Visual switch only — DO NOT add onClick here. This span sits inside
                  the <label>, so a click already activates the hidden checkbox below
                  (firing its onChange → toggle once). An onClick here fired toggle a
                  SECOND time, so the two cancelled out and the switch "did nothing". */}
              <span
                role="switch"
                aria-checked={on}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-gray-300"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
                />
              </span>
              {/* Hidden checkbox keeps the label semantics + keyboard accessible. */}
              <input
                type="checkbox"
                className="sr-only"
                checked={on}
                onChange={() => toggle(o.key)}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] h-4">
        {status === "saving" && <span className="text-gray-500">Saving…</span>}
        {status === "saved"  && <span className="text-emerald-700">✅ Saved</span>}
        {status === "error"  && <span className="text-red-600">⚠ Couldn't save — try again</span>}
      </div>
    </div>
  );
}

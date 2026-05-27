"use client";

/**
 * Synthesised notification sounds — generated via Web Audio API.
 *
 * Why not audio files: keeps the PWA tiny, works offline, no licensing
 * concerns, no extra HTTP request per beep. Three tones distinguish
 * urgency at a glance (Lalit's ask: "different sounds for all actions").
 *
 *   INFO     — soft two-note chime  (440 → 660 Hz, sine, 220ms)
 *   WARNING  — single mid ding      (660 Hz, square, 280ms)
 *   CRITICAL — urgent triple beep   (880 Hz × 3, sawtooth, 100ms each)
 *
 * User can mute via `setNotifSoundEnabled(false)` — persists to
 * localStorage and applies across all NotifBell instances on this device.
 */

const STORAGE_KEY = "wcr.notifSoundEnabled";

export type NotifSeverity = "INFO" | "WARNING" | "CRITICAL";

let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    // Older Safari uses webkitAudioContext. Cast through unknown so TS doesn't
    // complain about Window not advertising either property in some lib targets.
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AudioCtor = w.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();
    return ctx;
  } catch {
    return null;
  }
}

/** Read the mute preference. Defaults to ENABLED (true) on first load. */
export function isNotifSoundEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem(STORAGE_KEY);
  return v == null ? true : v === "true";
}

/** Persist the mute toggle. */
export function setNotifSoundEnabled(enabled: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
}

/** Schedule a single oscillator tone — quick, fades out cleanly. */
function tone(opts: { freq: number; type: OscillatorType; durationMs: number; volume?: number; startOffsetMs?: number }) {
  const audio = getCtx();
  if (!audio) return;
  const t0 = audio.currentTime + (opts.startOffsetMs ?? 0) / 1000;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = opts.type;
  osc.frequency.value = opts.freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(opts.volume ?? 0.18, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.durationMs / 1000);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + opts.durationMs / 1000 + 0.05);
}

/** Play the chime for a given severity. Silent no-op when muted or AudioContext unavailable. */
export function playNotifSound(severity: NotifSeverity) {
  if (!isNotifSoundEnabled()) return;
  const audio = getCtx();
  if (!audio) return;
  // Resume context if browser has it suspended (autoplay policy — first user gesture needed)
  if (audio.state === "suspended") audio.resume().catch(() => {});

  if (severity === "INFO") {
    // Pleasant 2-note chime — new lead, FYI
    tone({ freq: 587.33, type: "sine", durationMs: 180, volume: 0.16 });                     // D5
    tone({ freq: 880.00, type: "sine", durationMs: 220, volume: 0.16, startOffsetMs: 110 }); // A5
  } else if (severity === "WARNING") {
    // Single firm ding — needs your attention soon
    tone({ freq: 660,    type: "triangle", durationMs: 280, volume: 0.20 });
    tone({ freq: 440,    type: "triangle", durationMs: 200, volume: 0.14, startOffsetMs: 140 });
  } else {
    // CRITICAL — urgent triple beep (SLA breach, manager intervention)
    tone({ freq: 880, type: "square", durationMs: 100, volume: 0.20, startOffsetMs: 0 });
    tone({ freq: 880, type: "square", durationMs: 100, volume: 0.20, startOffsetMs: 160 });
    tone({ freq: 880, type: "square", durationMs: 130, volume: 0.20, startOffsetMs: 320 });
  }
}

"use client";

/**
 * Synthesised notification sounds — generated via the Web Audio API (no audio
 * files: tiny PWA, offline-safe, no licensing, no extra request).
 *
 * Lalit's spec (2026-06-20): a NEW LEAD must be impossible to miss.
 *   • Six selectable alert sounds (Bell / Alert / Chime / Success / Siren /
 *     Premium CRM Alert), each previewable before choosing.
 *   • Four volume levels (Low / Medium / High / Maximum) — DEFAULT HIGH, and
 *     much louder than the old 0.18–0.45 gains.
 *   • Choice persists per user (server) + per device (localStorage cache here,
 *     so the AudioContext can fire instantly without a round-trip).
 *
 * The OS-level alert (when the tab is closed / minimised / another app is in
 * front) is handled separately by Web Push + the service worker; this module is
 * the IN-APP sound that fires while a CRM tab is open.
 */

const KEY_ENABLED = "wcr.notifSoundEnabled";
const KEY_SOUND = "wcr.notifSound";
const KEY_VOLUME = "wcr.notifVolume";

export type NotifSeverity = "INFO" | "WARNING" | "CRITICAL";

export const NOTIF_SOUNDS = [
  { id: "bell",    label: "Bell" },
  { id: "alert",   label: "Alert" },
  { id: "chime",   label: "Chime" },
  { id: "success", label: "Success" },
  { id: "siren",   label: "Siren (short)" },
  { id: "premium", label: "Premium CRM Alert" },
] as const;
export type NotifSoundId = (typeof NOTIF_SOUNDS)[number]["id"];

export const VOLUME_LEVELS = [
  { id: "low",     label: "Low" },
  { id: "medium",  label: "Medium" },
  { id: "high",    label: "High" },
  { id: "maximum", label: "Maximum" },
] as const;
export type VolumeLevel = (typeof VOLUME_LEVELS)[number]["id"];

// Per-tone gain multiplier per level. High ≈ full-scale on a single tone;
// Maximum intentionally pushes into mild clipping = maximally attention-grabbing.
const VOL_MULT: Record<VolumeLevel, number> = { low: 0.35, medium: 0.65, high: 1.0, maximum: 1.55 };

export const DEFAULT_SOUND: NotifSoundId = "premium";
export const DEFAULT_VOLUME: VolumeLevel = "high"; // Lalit: default High

function isSoundId(v: string | null): v is NotifSoundId {
  return !!v && NOTIF_SOUNDS.some((s) => s.id === v);
}
function isVolume(v: string | null): v is VolumeLevel {
  return !!v && VOLUME_LEVELS.some((l) => l.id === v);
}

// ── Persistence (device cache; server is the source of truth, synced in on load) ──
export function getChosenSound(): NotifSoundId {
  if (typeof localStorage === "undefined") return DEFAULT_SOUND;
  const v = localStorage.getItem(KEY_SOUND);
  return isSoundId(v) ? v : DEFAULT_SOUND;
}
export function getChosenVolume(): VolumeLevel {
  if (typeof localStorage === "undefined") return DEFAULT_VOLUME;
  const v = localStorage.getItem(KEY_VOLUME);
  return isVolume(v) ? v : DEFAULT_VOLUME;
}
export function setChosenSound(id: NotifSoundId) {
  try { localStorage.setItem(KEY_SOUND, id); } catch {}
}
export function setChosenVolume(level: VolumeLevel) {
  try { localStorage.setItem(KEY_VOLUME, level); } catch {}
}
/** Mute toggle — defaults ENABLED. */
export function isNotifSoundEnabled(): boolean {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem(KEY_ENABLED);
  return v == null ? true : v === "true";
}
export function setNotifSoundEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY_ENABLED, enabled ? "true" : "false"); } catch {}
}

// ── Web Audio plumbing ───────────────────────────────────────────────────────
let ctx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AudioCtor = w.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtor) return null;
    ctx = new AudioCtor();
    return ctx;
  } catch { return null; }
}

interface Tone { freq: number; type: OscillatorType; durationMs: number; gain: number; startMs?: number }
function play(tones: Tone[], mult: number) {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") audio.resume().catch(() => {});
  for (const tn of tones) {
    const t0 = audio.currentTime + (tn.startMs ?? 0) / 1000;
    const osc = audio.createOscillator();
    const g = audio.createGain();
    osc.type = tn.type;
    osc.frequency.value = tn.freq;
    const peak = Math.min(2.0, tn.gain * mult);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + tn.durationMs / 1000);
    osc.connect(g).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + tn.durationMs / 1000 + 0.05);
  }
}

// ── The six sounds (note sequences) ──────────────────────────────────────────
const PATTERNS: Record<NotifSoundId, Tone[]> = {
  // Service bell — two struck sine tones with a long ring-out.
  bell: [
    { freq: 880,  type: "sine", durationMs: 650, gain: 0.6 },
    { freq: 1318, type: "sine", durationMs: 700, gain: 0.5, startMs: 30 },
  ],
  // Two-tone alarm — quick high/low alternation, square = cuts through noise.
  alert: [
    { freq: 784, type: "square", durationMs: 140, gain: 0.55 },
    { freq: 587, type: "square", durationMs: 140, gain: 0.55, startMs: 160 },
    { freq: 784, type: "square", durationMs: 140, gain: 0.55, startMs: 320 },
    { freq: 587, type: "square", durationMs: 180, gain: 0.55, startMs: 480 },
  ],
  // Pleasant ascending arpeggio C-E-G-C.
  chime: [
    { freq: 523,  type: "sine", durationMs: 180, gain: 0.5 },
    { freq: 659,  type: "sine", durationMs: 180, gain: 0.5, startMs: 110 },
    { freq: 784,  type: "sine", durationMs: 180, gain: 0.5, startMs: 220 },
    { freq: 1046, type: "sine", durationMs: 300, gain: 0.5, startMs: 330 },
  ],
  // Positive rising triad — "task done" feel.
  success: [
    { freq: 523,  type: "triangle", durationMs: 150, gain: 0.55 },
    { freq: 659,  type: "triangle", durationMs: 150, gain: 0.55, startMs: 100 },
    { freq: 1046, type: "triangle", durationMs: 360, gain: 0.6,  startMs: 200 },
  ],
  // Short siren — a single up-down sweep approximated by stepped tones.
  siren: [
    { freq: 600,  type: "sawtooth", durationMs: 120, gain: 0.5 },
    { freq: 760,  type: "sawtooth", durationMs: 120, gain: 0.52, startMs: 110 },
    { freq: 980,  type: "sawtooth", durationMs: 130, gain: 0.54, startMs: 220 },
    { freq: 760,  type: "sawtooth", durationMs: 120, gain: 0.52, startMs: 350 },
    { freq: 600,  type: "sawtooth", durationMs: 150, gain: 0.5,  startMs: 470 },
  ],
  // Designed CRM motif — two crisp high pings then a richer resolving tone + echo.
  premium: [
    { freq: 1046, type: "sine",     durationMs: 90,  gain: 0.55 },
    { freq: 1318, type: "sine",     durationMs: 90,  gain: 0.55, startMs: 110 },
    { freq: 880,  type: "triangle", durationMs: 360, gain: 0.65, startMs: 230 },
    { freq: 1760, type: "sine",     durationMs: 220, gain: 0.28, startMs: 250 },
  ],
};

/** Play a specific sound at a specific volume (preview/test path — ignores mute). */
export function playSound(id: NotifSoundId, level: VolumeLevel = getChosenVolume()) {
  play(PATTERNS[id] ?? PATTERNS[DEFAULT_SOUND], VOL_MULT[level] ?? VOL_MULT[DEFAULT_VOLUME]);
}
/** Preview the given sound at the user's current volume (Settings UI). */
export function previewSound(id: NotifSoundId) {
  playSound(id, getChosenVolume());
}

/**
 * Play the user's chosen alert sound for an incoming notification. Respects the
 * mute toggle. CRITICAL (hot lead / SLA / new lead) bumps the volume one level
 * and double-rings so it's impossible to miss.
 */
export function playNotifSound(severity: NotifSeverity = "INFO") {
  if (!isNotifSoundEnabled()) return;
  const sound = getChosenSound();
  const base = getChosenVolume();
  if (severity === "CRITICAL") {
    const louder: VolumeLevel = base === "low" ? "medium" : base === "medium" ? "high" : "maximum";
    playSound(sound, louder);
    setTimeout(() => playSound(sound, louder), 600); // second ring
  } else {
    playSound(sound, base);
  }
}

/** Explicit "new lead arrived" alert — always treated as high-urgency. */
export function playLeadAlert() {
  if (!isNotifSoundEnabled()) return;
  playNotifSound("CRITICAL");
}

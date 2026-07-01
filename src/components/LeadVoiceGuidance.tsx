"use client";
// LeadVoiceGuidance — Channel ① "Manager Voice Guidance" on the Lead View.
// Admin/Lalit records a voice note (ORIGINAL audio saved + live browser transcript);
// the assigned agent plays it back, reads the transcript, and marks it understood.
// Compact + premium, light + dark. Separate from the Escalation Thread (Channel ②).
//
// Recording captures BOTH: MediaRecorder (the audio we persist, played back exactly)
// AND the Web Speech API live transcript (editable before save). Degrades gracefully:
// no SpeechRecognition → record audio + type the transcript; no MediaRecorder → hidden.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";

export interface VoiceGuidanceMsg {
  id: string;
  by: string;
  at: string;            // ISO
  transcript: string | null;
  title: string | null;
  durationSec: number | null;
  understood: boolean;   // has the CURRENT viewer marked it understood
  mine: boolean;         // did the current viewer create it (admin) — no "mark understood" for own
}

interface Props {
  leadId: string;
  isAdmin: boolean;
  messages: VoiceGuidanceMsg[];
  /**
   * API base for the voice-message endpoints. Defaults to "/api/leads" so every
   * existing Lead caller is unchanged. The Buyer Data view passes "/api/buyer-data",
   * which exposes the SAME voice-message contract for BuyerRecords — so this one
   * component renders Manager Voice Guidance identically on both modules
   * (same pattern as StickyNoteWidget.apiBase / LeadFollowupActions.apiBase).
   */
  apiBase?: string;
}

const fmtIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) + " IST";

const fmtDur = (s: number | null) => {
  if (!s || s <= 0) return "";
  const m = Math.floor(s / 60); const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
};

// ── Minimal SpeechRecognition typing (lib.dom lacks it) ──
interface SRInstance { continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void; }
type SRCtor = new () => SRInstance;

// ── Compact custom audio player (▶ / ⏸ + duration) — streams inline, no download ──
function VoicePlayer({ src, durationSec }: { src: string; durationSec: number | null }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          const a = ref.current; if (!a) return;
          if (playing) { a.pause(); } else { a.play().catch(() => setErr(true)); }
        }}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
        aria-label={playing ? "Pause voice message" : "Play voice message"}
      >
        <span aria-hidden>{playing ? "⏸" : "▶"}</span> Play Voice
        {durationSec ? <span className="opacity-70 font-mono">{fmtDur(durationSec)}</span> : null}
      </button>
      {err && <span className="text-[10px] text-red-600">playback failed</span>}
      <audio
        ref={ref} src={src} preload="none" className="hidden"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onError={() => setErr(true)}
      />
    </span>
  );
}

// ── One guidance message card ──
function MessageCard({ leadId, m, apiBase }: { leadId: string; m: VoiceGuidanceMsg; apiBase: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(m.understood);
  const [busy, setBusy] = useState(false);
  async function markUnderstood() {
    setBusy(true);
    try {
      const r = await fetch(`${apiBase}/${leadId}/voice-message/${m.id}/understood`, { method: "POST" });
      if (r.ok) { setUnderstood(true); router.refresh(); }
    } finally { setBusy(false); }
  }
  const unread = !m.mine && !understood;
  return (
    <li className={`rounded-lg border p-2.5 ${unread
      ? "border-amber-300 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20"
      : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800/40"}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1.5">
            {unread && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 flex-none" aria-label="unread" />}
            🎤 Voice message by {m.by}
          </div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">{fmtIST(m.at)}{m.title ? ` · ${m.title}` : ""}</div>
        </div>
        <VoicePlayer src={`${apiBase}/${leadId}/voice-message/${m.id}/audio`} durationSec={m.durationSec} />
      </div>
      {m.transcript && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="text-[11px] text-[#0b1a33] dark:text-blue-300 hover:underline font-medium">
            {open ? "Hide transcript" : "View transcript"}
          </button>
          {open && (
            <p className="mt-1 text-xs text-gray-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed bg-gray-50 dark:bg-slate-900/40 rounded p-2 border border-gray-100 dark:border-slate-700">
              {m.transcript}
            </p>
          )}
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-gray-400 dark:text-slate-500">Created by: {m.by}</span>
        {m.mine ? null : understood
          ? <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">✓ Understood</span>
          : <button type="button" onClick={markUnderstood} disabled={busy}
              className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/30 disabled:opacity-50">
              {busy ? "Saving…" : "Mark as understood"}
            </button>}
      </div>
    </li>
  );
}

// ── Admin recorder (MediaRecorder audio + Web Speech transcript) ──
function Recorder({ leadId, apiBase }: { leadId: string; apiBase: string }) {
  const router = useRouter();
  type Phase = "idle" | "recording" | "review" | "saving";
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const recRef = useRef<SRInstance | null>(null);
  const finalRef = useRef("");
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(0);
  const durRef = useRef(0);

  const [SR, setSR] = useState<SRCtor | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as any;
    setSR(() => w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null);
  }, []);
  useEffect(() => () => { // cleanup
    try { recRef.current?.abort(); } catch {}
    try { mediaRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (tickRef.current) clearInterval(tickRef.current);
  }, []);

  async function start() {
    setErr(null); setTranscript(""); setTitle(""); finalRef.current = "";
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr("Microphone blocked. Allow mic access in your browser, then try again."); return;
    }
    streamRef.current = stream;
    chunksRef.current = []; blobRef.current = null;
    const mime = (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm")) ? "audio/webm" : "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      blobRef.current = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      durRef.current = Math.round((Date.now() - startedRef.current) / 1000);
      setTranscript((prev) => prev || finalRef.current.trim());
      setPhase("review");
    };
    mediaRef.current = mr;
    mr.start();

    // Web Speech (best-effort, parallel) for the live transcript.
    if (SR) {
      try {
        const rec = new SR();
        rec.continuous = true; rec.interimResults = true; rec.lang = "en-IN";
        rec.onresult = (e: any) => {
          let add = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) add += e.results[i][0].transcript;
          }
          if (add) { finalRef.current = (finalRef.current + " " + add).replace(/\s+/g, " ").trim(); setTranscript(finalRef.current); }
        };
        rec.onerror = () => {};
        rec.onend = () => { if (phase === "recording") { try { rec.start(); } catch {} } };
        rec.start(); recRef.current = rec;
      } catch {}
    }

    startedRef.current = Date.now(); setElapsed(0);
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 250);
    setPhase("recording");
  }

  function stop() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { recRef.current?.stop(); } catch {}
    try { mediaRef.current?.stop(); } catch {}
  }

  async function save() {
    const blob = blobRef.current;
    if (!blob || blob.size === 0) { setErr("No audio captured — record again."); return; }
    setPhase("saving"); setErr(null);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "voice.webm");
      fd.append("transcript", transcript.trim());
      fd.append("title", title.trim());
      fd.append("durationSec", String(durRef.current || 0));
      fd.append("lang", "en-IN");
      const r = await fetch(`${apiBase}/${leadId}/voice-message`, { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `HTTP ${r.status}`); }
      blobRef.current = null; setTranscript(""); setTitle(""); setPhase("idle");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save."); setPhase("review");
    }
  }

  function discard() {
    blobRef.current = null; chunksRef.current = []; setTranscript(""); setTitle(""); setErr(null); setPhase("idle");
  }

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="rounded-lg border border-dashed border-[#0b1a33]/30 dark:border-blue-700/40 p-2.5 bg-[#0b1a33]/[0.03] dark:bg-blue-950/10">
      {phase === "idle" && (
        <button type="button" onClick={start}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 dark:bg-blue-700 dark:hover:bg-blue-600 transition-colors">
          <Mic className="w-4 h-4" /> Record Voice Note
        </button>
      )}
      {phase === "recording" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={stop}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-gray-800 text-white hover:bg-gray-900">⏸ Stop</button>
            <span className="inline-flex items-center gap-1.5 text-xs font-mono text-red-600 dark:text-red-400">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
              {mmss}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-slate-400">Recording… speak in any language</span>
          </div>
          {transcript && <p className="text-xs text-gray-600 dark:text-slate-300 italic line-clamp-2">{transcript}</p>}
        </div>
      )}
      {(phase === "review" || phase === "saving") && (
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional title / category"
            disabled={phase === "saving"}
            className="w-full text-xs border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-900 dark:text-slate-100" />
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)}
            placeholder="Transcript (auto-filled — edit if needed; the audio is saved exactly as recorded)"
            disabled={phase === "saving"}
            className="w-full text-xs border border-gray-300 dark:border-slate-600 rounded p-2 min-h-[64px] bg-white dark:bg-slate-900 dark:text-slate-100" />
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={phase === "saving"}
              className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">
              {phase === "saving" ? "Saving…" : "✅ Save voice note"}</button>
            <button type="button" onClick={discard} disabled={phase === "saving"}
              className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-slate-600 dark:text-slate-200">Discard</button>
          </div>
        </div>
      )}
      {err && <div className="mt-1.5 text-[11px] text-red-700 dark:text-red-400">{err}</div>}
    </div>
  );
}

export default function LeadVoiceGuidance({ leadId, isAdmin, messages, apiBase = "/api/leads" }: Props) {
  const unread = messages.filter((m) => !m.mine && !m.understood).length;
  if (!isAdmin && messages.length === 0) return null; // agents see nothing until guidance exists
  return (
    <div className="card p-4" data-lead-section="voice-guidance">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">🎤 Manager Voice Guidance</span>
        {unread > 0 && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700">
            {unread} new
          </span>
        )}
      </div>
      {isAdmin && <div className="mb-3"><Recorder leadId={leadId} apiBase={apiBase} /></div>}
      {messages.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">No voice guidance yet.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => <MessageCard key={m.id} leadId={leadId} m={m} apiBase={apiBase} />)}
        </ul>
      )}
    </div>
  );
}

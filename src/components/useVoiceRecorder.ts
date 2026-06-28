"use client";
// useVoiceRecorder — shared mic-capture hook for the Lead Voice Communication
// channels. Captures BOTH the original audio (MediaRecorder → the bytes we persist
// and play back verbatim) AND a live browser transcript (Web Speech API, editable
// before save). Degrades gracefully: no SpeechRecognition → record audio + type the
// transcript; no MediaRecorder → `supported` is false and the caller hides the mic.
//
// Channel ② (Escalation Thread) uses this. Channel ① (LeadVoiceGuidance) keeps its
// own inline copy for now — this hook is the DRY home for any new voice surface.
import { useCallback, useEffect, useRef, useState } from "react";

// Minimal SpeechRecognition typing (lib.dom lacks it).
interface SRInstance {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((e: unknown) => void) | null; onerror: ((e: unknown) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
}
type SRCtor = new () => SRInstance;

function getSR(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface VoiceRecorder {
  recording: boolean;
  seconds: number;
  transcript: string;
  setTranscript: (t: string) => void;
  audioBlob: Blob | null;
  audioUrl: string | null;     // object URL for local preview before upload
  supported: boolean;          // MediaRecorder available
  speechSupported: boolean;    // live STT available
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useVoiceRecorder(lang = "en-IN"): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [speechSupported, setSpeechSupported] = useState(false);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const srRef = useRef<SRInstance | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finalRef = useRef("");          // committed (final) STT text

  useEffect(() => {
    setSupported(typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && !!navigator.mediaDevices);
    setSpeechSupported(!!getSR());
  }, []);

  const clearTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; } };

  const reset = useCallback(() => {
    setRecording(false); setSeconds(0); setTranscript(""); setError(null);
    setAudioBlob(null);
    setAudioUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    finalRef.current = ""; chunksRef.current = [];
    clearTick();
  }, []);

  const stop = useCallback(() => {
    try { mediaRef.current?.state !== "inactive" && mediaRef.current?.stop(); } catch { /* noop */ }
    try { mediaRef.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    try { srRef.current?.stop(); } catch { /* noop */ }
    clearTick();
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) { setError("Recording isn't supported on this device/browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
      };
      mr.start();

      // Live transcript (best-effort). Audio capture is the source of truth.
      const SR = getSR();
      if (SR) {
        const sr = new SR();
        sr.continuous = true; sr.interimResults = true; sr.lang = lang;
        finalRef.current = transcript ? transcript + " " : "";
        sr.onresult = (e: unknown) => {
          const ev = e as { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
          let interim = "";
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            const r = ev.results[i];
            const txt = r[0]?.transcript ?? "";
            if (r.isFinal) finalRef.current += txt + " "; else interim += txt;
          }
          setTranscript((finalRef.current + interim).trimStart());
        };
        sr.onerror = () => { /* keep recording audio even if STT fails */ };
        srRef.current = sr;
        try { sr.start(); } catch { /* already started / unsupported */ }
      }

      setSeconds(0);
      clearTick();
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecording(true);
    } catch {
      setError("Microphone permission denied or unavailable.");
      setRecording(false);
    }
  }, [supported, lang, transcript]);

  useEffect(() => () => { stop(); if (audioUrl) URL.revokeObjectURL(audioUrl); }, [stop, audioUrl]);

  return { recording, seconds, transcript, setTranscript, audioBlob, audioUrl, supported, speechSupported, error, start, stop, reset };
}

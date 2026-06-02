"use client";
// VaultVoiceInput — small mic toggle for the Vault (Quick Vent / Win / mood note).
// Lets an agent speak in Hindi or English and have the FINAL transcript appended
// into a textarea via the onTranscript callback.
//
// Like VoiceNoteRecorder, this uses the browser-native Web Speech API
// (SpeechRecognition / webkitSpeechRecognition) — free, no STT key, live in the
// browser. Works in Chrome / Edge / Safari iOS; Firefox doesn't implement it, so
// we degrade gracefully by hiding the button when the API is unavailable.

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

// Minimal Web Speech API typing — lib.dom.d.ts doesn't ship these (draft spec).
// Mirrors the inline pattern in VoiceNoteRecorder.tsx; only the bits we use.
interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [i: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SRInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SRCtor = new () => SRInstance;

type Lang = "en-IN" | "hi-IN";

interface Props {
  /** Called with each FINAL transcript chunk. Parent appends (with a leading
   *  space if existing text). */
  onTranscript: (text: string) => void;
  /** Optional extra classes for the wrapper. */
  className?: string;
}

export default function VaultVoiceInput({ onTranscript, className }: Props) {
  const [lang, setLang] = useState<Lang>("en-IN");
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<SRInstance | null>(null);
  // Track whether the user pressed stop so onend doesn't auto-restart.
  const stoppedByUserRef = useRef(false);
  // Keep the latest callback in a ref so the recognition handlers always call
  // the current closure without us having to recreate the recogniser.
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  // Keep the latest language in a ref so a long-running session that auto-ends
  // can restart with the currently-selected language.
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;

  // Resolve the constructor once on mount — SSR-safe (window is browser-only).
  // null means the browser doesn't support the API → we hide the button.
  const [SR, setSR] = useState<SRCtor | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as {
      SpeechRecognition?: SRCtor;
      webkitSpeechRecognition?: SRCtor;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
    setSR(() => Ctor);
  }, []);

  // Cleanup on unmount: abort any live session so the mic indicator doesn't
  // linger after navigating away.
  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true;
      try {
        recognitionRef.current?.abort();
      } catch {
        /* no-op — safe to swallow during teardown */
      }
    };
  }, []);

  // If the user flips EN/हिं while listening, restart with the new lang so the
  // change takes effect immediately (recognition.lang is read at start()).
  useEffect(() => {
    if (!listening || !recognitionRef.current) return;
    // stop() then rely on onend's auto-restart (stoppedByUserRef stays false).
    try {
      recognitionRef.current.stop();
    } catch {
      /* onend will still fire */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  function start() {
    if (!SR) return;
    stoppedByUserRef.current = false;

    let recognition: SRInstance;
    try {
      recognition = new SR();
    } catch {
      // Couldn't init — just leave the toggle off, no UI noise.
      setListening(false);
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current;

    recognition.onresult = (event: SREvent) => {
      // Append only FINAL chunks; interim results are ignored here so the
      // textarea never fills with half-recognised words.
      let appendFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) appendFinal += text;
      }
      const clean = appendFinal.replace(/\s+/g, " ").trim();
      if (clean) onTranscriptRef.current(clean);
    };

    recognition.onerror = (event: SRErrorEvent) => {
      // "aborted" is our own stop — ignore. Everything else: stop quietly so
      // the agent's workflow never breaks (they can still type).
      if (event.error === "aborted") return;
      stoppedByUserRef.current = true;
      setListening(false);
    };

    recognition.onend = () => {
      // The engine can stop on its own (silence timeout). If the user didn't
      // press stop, restart so dictation feels continuous.
      if (!stoppedByUserRef.current) {
        try {
          recognition.lang = langRef.current;
          recognition.start();
          return;
        } catch {
          /* fall through to idle */
        }
      }
      setListening(false);
    };

    try {
      recognition.start();
    } catch {
      setListening(false);
      return;
    }
    recognitionRef.current = recognition;
    setListening(true);
  }

  function stop() {
    stoppedByUserRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore — onend will still fire */
    }
    setListening(false);
  }

  function toggle() {
    if (listening) stop();
    else start();
  }

  // Unsupported browser → render nothing (graceful no-op).
  if (SR === null) return null;

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop voice input" : "Start voice input"}
        title={listening ? "Stop voice input" : "Speak to add text"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium min-h-9 transition ${
          listening
            ? "bg-rose-600 text-white border-rose-700"
            : "bg-white text-gray-700 border-gray-200 hover:border-rose-300"
        }`}
      >
        {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
        {listening ? (
          <span className="inline-flex items-center gap-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            listening…
          </span>
        ) : (
          "Speak"
        )}
      </button>

      {/* Language switch: EN (en-IN) / हिं (hi-IN) */}
      <div className="inline-flex rounded-full border border-gray-200 overflow-hidden" role="group" aria-label="Voice language">
        <button
          type="button"
          onClick={() => setLang("en-IN")}
          aria-pressed={lang === "en-IN"}
          className={`px-2 py-1 text-[11px] min-h-9 transition ${
            lang === "en-IN" ? "bg-[#0b1a33] text-white" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          EN
        </button>
        <button
          type="button"
          onClick={() => setLang("hi-IN")}
          aria-pressed={lang === "hi-IN"}
          className={`px-2 py-1 text-[11px] min-h-9 transition ${
            lang === "hi-IN" ? "bg-[#0b1a33] text-white" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          हिं
        </button>
      </div>
    </div>
  );
}

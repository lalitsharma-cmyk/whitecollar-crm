"use client";
// VoiceNoteRecorder — Lalit's ask (verbatim):
//   "There should be a voice recording feature , and it should auto write
//    whatever agents says."
//
// Implementation: browser-native Web Speech API (SpeechRecognition /
// webkitSpeechRecognition). Free, no STT key required, live transcription
// while the agent speaks. Works in Chrome, Edge, and Safari iOS — Firefox
// does not implement the API today (see browser support matrix in agent
// hand-off notes).
//
// Earlier iterations of this component used MediaRecorder + a server-side
// /api/transcribe endpoint, but Anthropic's SDK has no audio input and we
// don't want to add a paid STT key. The Web Speech API gives us live
// streaming text for free, right in the browser — which is exactly the UX
// Lalit asked for ("auto write whatever agents says").
//
// Designed to degrade gracefully:
//   • Browser without SpeechRecognition (Firefox, old WebView) → friendly
//     fallback explaining where it works + textarea so the agent can still
//     type the note (workflow never breaks).
//   • Mic permission denied → specific inline error from onerror handler.
//   • Empty transcript → save button disabled, no silent failures.

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

interface Props {
  leadId: string;
  /** Optional callback when a transcript has been confirmed as a note. */
  onTranscribed?: (text: string) => void;
}

type Phase = "idle" | "recording" | "review" | "saving" | "done" | "error";

// Minimal shape of the Web Speech API SpeechRecognition object — typed inline
// because lib.dom.d.ts doesn't ship these (it's a draft spec). Only the bits
// we actually use are declared.
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

export default function VoiceNoteRecorder({ leadId, onTranscribed }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  // finalTranscript = locked-in pieces; interim = current word(s) still being
  // recognised. We render `finalTranscript + interimTranscript` so the user
  // sees the live tail update as they speak.
  const [finalTranscript, setFinalTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  // After Stop the user can edit the merged transcript — kept separate from
  // finalTranscript so onresult callbacks don't clobber edits.
  const [editableTranscript, setEditableTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognitionRef = useRef<SRInstance | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track whether the user pressed Stop so onend doesn't auto-restart.
  const stoppedByUserRef = useRef(false);
  // Ref copies of transcript state — avoids stale closures in stopRecording
  // and in the onend restart loop (state captured at callback creation time
  // is always the initial empty string due to JS closure semantics).
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  // Whether a recording session is currently active — used by onend restart.
  const isRecordingRef = useRef(false);

  // Resolve the constructor once on mount — SSR safe, since `window` only
  // exists in the browser. `null` here means the browser doesn't support it.
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

  // Cleanup on unmount: kill the recognition session and timer so the
  // browser's mic indicator doesn't linger after navigating away.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        /* no-op — safe to swallow during teardown */
      }
    };
  }, []);

  function startRecording() {
    if (!SR) return;
    setErrorMsg(null);
    setFinalTranscript("");
    setInterimTranscript("");
    setEditableTranscript("");
    stoppedByUserRef.current = false;

    let recognition: SRInstance;
    try {
      recognition = new SR();
    } catch (e) {
      console.warn("SpeechRecognition init failed", e);
      setErrorMsg("Couldn't start voice recognition in this browser. Type the note below instead.");
      setPhase("error");
      return;
    }
    recognition.continuous = true;
    recognition.interimResults = true;
    // en-IN — Lalit's team primarily works the India / Dubai pipeline and
    // Indian-English accent recognition is meaningfully better with this lang
    // tag than the en-US default.
    recognition.lang = "en-IN";

    recognition.onresult = (event: SREvent) => {
      // Walk only the new results from this event (resultIndex onwards) —
      // anything before that we've already folded into finalTranscript.
      let interim = "";
      let appendFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) {
          appendFinal += text;
        } else {
          interim += text;
        }
      }
      if (appendFinal) {
        setFinalTranscript((prev) => {
          const next = (prev + appendFinal).replace(/\s+/g, " ");
          // Keep ref in sync so stopRecording reads the latest value.
          finalTranscriptRef.current = next;
          return next;
        });
      }
      interimTranscriptRef.current = interim;
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SRErrorEvent) => {
      // Specific, friendly messages per the Web Speech API error vocabulary.
      let msg = "Voice recognition failed. Type the note below instead.";
      if (event.error === "no-speech") {
        msg = "Didn't hear anything — try again and speak closer to the mic.";
      } else if (event.error === "audio-capture") {
        msg = "No microphone detected. Plug one in or pick a different device.";
      } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        msg = "Microphone blocked. Allow mic access in your browser settings, then try again.";
      } else if (event.error === "network") {
        msg = "Voice recognition needs internet to work. Reconnect and try again.";
      } else if (event.error === "aborted") {
        // User-initiated stop — no error UI needed.
        return;
      }
      setErrorMsg(msg);
    };

    recognition.onend = () => {
      // On iOS/Safari, continuous mode causes onend to fire immediately after
      // every utterance pause. Restart the session automatically when the user
      // hasn't pressed Stop, so recording stays live.
      if (isRecordingRef.current && !stoppedByUserRef.current) {
        try {
          recognition.start();
          return; // Stay in "recording" phase — don't transition yet
        } catch {
          /* If restart throws (e.g. already running), fall through to review */
        }
      }
      // Stop the elapsed-time tick once recognition actually ends.
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      isRecordingRef.current = false;
      // If the user stopped it deliberately, move into review with whatever
      // we captured. If the engine ended on its own (silence timeout, etc.)
      // also drop into review rather than silently going back to idle.
      setPhase((current) => (current === "recording" ? "review" : current));
    };

    try {
      recognition.start();
    } catch (e) {
      console.warn("recognition.start() threw", e);
      setErrorMsg("Couldn't start recording. Try again in a moment.");
      setPhase("error");
      return;
    }
    recognitionRef.current = recognition;
    isRecordingRef.current = true;
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    tickRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);
    setPhase("recording");
  }

  function stopRecording() {
    stoppedByUserRef.current = true;
    isRecordingRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore — onend will still fire */
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    // Seed the editable textarea with whatever's been captured so far.
    // Read from REFS (not state) to get the actual latest value — the state
    // variables captured in this closure reflect the render when stopRecording
    // was defined, not the current values at call time (stale closure).
    // A short delay lets the engine emit any pending final result before we snapshot.
    setTimeout(() => {
      setEditableTranscript((prev) => {
        if (prev) return prev; // user already edited
        const merged = (finalTranscriptRef.current + " " + interimTranscriptRef.current)
          .trim()
          .replace(/\s+/g, " ");
        return merged;
      });
    }, 300);
  }

  async function confirmNote() {
    const content = editableTranscript.trim();
    if (!content) {
      setErrorMsg("Note is empty — record again or type something before saving.");
      return;
    }
    setPhase("saving");
    setErrorMsg(null);
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(leadId)}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      onTranscribed?.(content);
      setEditableTranscript("");
      setFinalTranscript("");
      setInterimTranscript("");
      setPhase("done");
      // Auto-reset so the agent can record again without a page refresh.
      setTimeout(() => setPhase("idle"), 1800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save note";
      setErrorMsg(msg);
      setPhase("review");
    }
  }

  function reset() {
    stoppedByUserRef.current = true;
    isRecordingRef.current = false;
    try {
      recognitionRef.current?.abort();
    } catch {
      /* no-op */
    }
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    finalTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    setPhase("idle");
    setFinalTranscript("");
    setInterimTranscript("");
    setEditableTranscript("");
    setErrorMsg(null);
    setElapsedSec(0);
  }

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  };

  // SR resolved to null after mount → browser doesn't support Web Speech API.
  // (During the very first render before useEffect runs SR is also null, but
  // since the component is "use client" the effect fires on hydration so the
  // fallback only flashes for an instant on unsupported browsers.)
  if (SR === null) {
    return (
      <div className="card p-3 border-l-4 border-gray-300 bg-gray-50">
        <div className="text-xs text-gray-600">
          🎙 Voice transcription works on Chrome / Edge / Safari iOS. Type the
          note below or open in a supported browser.
        </div>
      </div>
    );
  }

  const liveText = (finalTranscript + " " + interimTranscript).trim();

  return (
    <div className="card p-3 border-l-4 border-red-400">
      <div className="flex items-center gap-2 mb-2">
        <Mic className="w-4 h-4 text-red-500 flex-none" />
        <div className="text-sm font-semibold">Voice note</div>
        <span className="text-[10px] text-gray-500">
          Tap to record · auto-writes as you speak
        </span>
      </div>

      {phase === "idle" && (
        <button
          type="button"
          onClick={startRecording}
          className="flex items-center justify-center gap-2 w-full min-h-11 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          <Mic className="w-4 h-4" /> Start recording
        </button>
      )}

      {phase === "recording" && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={stopRecording}
              className="btn btn-primary flex-1 justify-center min-h-11 text-sm font-semibold bg-gray-800 hover:bg-gray-900 border-gray-900 text-white"
            >
              ⏸ Stop
            </button>
            <span className="flex items-center gap-1 text-xs font-mono">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              {fmtTime(elapsedSec)}
            </span>
          </div>
          <div
            className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[88px] bg-white"
            aria-live="polite"
          >
            {liveText ? (
              <>
                <span>{finalTranscript}</span>
                {interimTranscript && (
                  <span className="text-gray-400 italic">
                    {finalTranscript ? " " : ""}
                    {interimTranscript}
                  </span>
                )}
              </>
            ) : (
              <span className="text-gray-400 italic">Listening… start speaking and your words will appear here.</span>
            )}
          </div>
          {errorMsg && (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {errorMsg}
            </div>
          )}
        </div>
      )}

      {(phase === "review" || phase === "saving") && (
        <div className="space-y-2">
          <textarea
            value={editableTranscript}
            onChange={(e) => setEditableTranscript(e.target.value)}
            placeholder="Transcript will appear here — edit it before saving as a note."
            className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[88px] focus:border-[#c9a24b] focus:outline-none"
            disabled={phase === "saving"}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmNote}
              disabled={phase === "saving" || !editableTranscript.trim()}
              className="btn btn-primary flex-1 justify-center min-h-11 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white disabled:opacity-60"
            >
              {phase === "saving" ? "Saving…" : "✅ Save as note"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={phase === "saving"}
              className="btn min-h-11 text-sm"
            >
              Discard
            </button>
          </div>
          {errorMsg && (
            <div className="text-[11px] text-red-700">{errorMsg}</div>
          )}
        </div>
      )}

      {phase === "done" && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-2">
          ✅ Saved. Ready for the next one.
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-2">
            {errorMsg ?? "Something went wrong."}
          </div>
          <button type="button" onClick={reset} className="btn min-h-9 text-xs self-start">
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

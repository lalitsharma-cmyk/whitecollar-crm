"use client";
// VoiceNoteRecorder — Lalit's ask (verbatim):
//   "There should be a voice recording feature , and it should auto write
//    whatever agents says."
//
// Browser-side MediaRecorder captures the agent's voice while they're on the
// lead detail page (typically after a call, summarising the conversation).
// On stop the audio blob POSTs to /api/transcribe?leadId=… and the returned
// transcript is shown in an editable textarea — agent can clean it up and
// confirm it as a Note (which POSTs to the existing /api/leads/[id]/notes).
//
// Designed to degrade gracefully:
//   • Browser doesn't support MediaRecorder → button disabled with reason
//   • Mic permission denied → friendly inline error, no console-only failure
//   • Transcription endpoint returns empty text → textarea still shows the
//     "note" message so the agent can type their own note instead of losing
//     the workflow entirely
//
// Mount instructions are in the parent agent's report — this file just
// exports the component; insertion lives on the lead detail page.

import { useEffect, useRef, useState } from "react";

interface Props {
  leadId: string;
  /** Optional callback when a transcript has been confirmed as a note. */
  onTranscribed?: (text: string) => void;
}

type Phase = "idle" | "recording" | "transcribing" | "review" | "saving" | "done" | "error";

export default function VoiceNoteRecorder({ leadId, onTranscribed }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Feature-detect MediaRecorder up-front so the button can disable when the
  // browser doesn't support it (older Safari, locked-down corporate IE shells).
  const supported = typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined";

  // Cleanup any open mic stream on unmount — otherwise the browser keeps the
  // red mic indicator on the tab after navigating away.
  useEffect(() => {
    return () => {
      tickRef.current && clearInterval(tickRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (!supported) return;
    setErrorMsg(null);
    setHint(null);
    setTranscript("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Prefer audio/webm — Chrome's default and what /api/transcribe expects.
      // Falls back to whatever the browser picks if webm isn't supported.
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 250);
      setPhase("recording");
    } catch (e) {
      console.warn("Mic access failed", e);
      setErrorMsg("Couldn't access the microphone. Check the browser permission and try again.");
      setPhase("error");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    tickRef.current && clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  async function handleStop() {
    setPhase("transcribing");
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    try {
      const r = await fetch(`/api/transcribe?leadId=${encodeURIComponent(leadId)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/webm" },
        body: blob,
      });
      const j = await r.json().catch(() => ({}));
      const txt = String(j.transcript ?? "").trim();
      if (j.note) setHint(String(j.note));
      setTranscript(txt);
      setPhase("review");
    } catch (e) {
      console.warn("Transcribe failed", e);
      setErrorMsg("Transcription failed. You can still type the note manually below and confirm.");
      setPhase("review");
    }
  }

  async function confirmNote() {
    const content = transcript.trim();
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
      setTranscript("");
      setHint(null);
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
    setPhase("idle");
    setTranscript("");
    setErrorMsg(null);
    setHint(null);
    setElapsedSec(0);
  }

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  };

  if (!supported) {
    return (
      <div className="card p-3 border-l-4 border-gray-300 bg-gray-50">
        <div className="text-xs text-gray-600">
          🎙 Voice note: your browser doesn&apos;t support recording. Use Chrome on
          desktop or Android to capture voice notes.
        </div>
      </div>
    );
  }

  return (
    <div className="card p-3 border-l-4 border-[#c9a24b]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">🎙</span>
        <div className="text-sm font-semibold">Voice note</div>
        <span className="text-[10px] text-gray-500">
          Tap to record · auto-transcribes when you stop
        </span>
      </div>

      {phase === "idle" && (
        <button
          type="button"
          onClick={startRecording}
          className="btn btn-primary w-full justify-center min-h-11 text-sm font-semibold bg-red-600 hover:bg-red-700 border-red-700 text-white"
        >
          ● Start recording
        </button>
      )}

      {phase === "recording" && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={stopRecording}
            className="btn btn-primary flex-1 justify-center min-h-11 text-sm font-semibold bg-gray-800 hover:bg-gray-900 border-gray-900 text-white"
          >
            ■ Stop & transcribe
          </button>
          <span className="flex items-center gap-1 text-xs font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            {fmtTime(elapsedSec)}
          </span>
        </div>
      )}

      {phase === "transcribing" && (
        <div className="text-xs text-gray-600 py-2">
          ⏳ Transcribing… this can take a few seconds.
        </div>
      )}

      {(phase === "review" || phase === "saving") && (
        <div className="space-y-2">
          {hint && <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{hint}</div>}
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Transcript will appear here — edit it before saving as a note."
            className="w-full text-sm border border-gray-300 rounded-lg p-2 min-h-[88px] focus:border-[#c9a24b] focus:outline-none"
            disabled={phase === "saving"}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmNote}
              disabled={phase === "saving" || !transcript.trim()}
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

      {errorMsg && phase === "review" && (
        <div className="mt-1 text-[11px] text-red-700">{errorMsg}</div>
      )}
    </div>
  );
}

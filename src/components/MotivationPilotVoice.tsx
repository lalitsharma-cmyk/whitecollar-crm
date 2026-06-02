"use client";
// MotivationPilotVoice — the optional spoken half of the B-20 motivation pilot.
//
// Mirrors the proven Web Speech API approach already shipping in
// AIMotivatorCard: fetch a short message from /api/ai/morning-message (which
// returns AI text when a key is set, otherwise a tasteful rule-based line) and
// speak it with the browser's window.speechSynthesis — no server-side TTS, no
// extra dependency, no external/AI call from this component itself.
//
// Degrades gracefully:
//   • Browser without speechSynthesis → a quiet one-liner, no broken button.
//   • Fetch/playback failure → inline, low-key error; never throws.
// Tone is deliberately understated: this is a workplace pilot whose whole
// purpose is to let Lalit judge whether the voice feels supportive vs gimmicky.

import { useEffect, useRef, useState } from "react";

type SpeakState = "idle" | "loading" | "speaking" | "error";

export default function MotivationPilotVoice({ aiOn }: { aiOn: boolean }) {
  const [speakState, setSpeakState] = useState<SpeakState>("idle");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cancel any in-flight speech if the component unmounts (e.g. navigation)
  // so the browser's audio doesn't linger.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const canSpeak =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  async function play() {
    if (!canSpeak) return;
    setSpeakState("loading");
    try {
      window.speechSynthesis.cancel(); // defensive: user may tap twice

      const r = await fetch("/api/ai/morning-message", { cache: "no-store" });
      const j = (await r.json()) as { message?: string };
      const text = String(j.message ?? "").trim();
      if (!text) throw new Error("Empty message");

      // Prefer an Indian-English voice so it sounds local to a Dubai+India
      // team; fall back gracefully through the available voices.
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang === "en-GB") ??
        voices.find((v) => v.lang.startsWith("en")) ??
        voices[0] ??
        null;

      const u = new SpeechSynthesisUtterance(text);
      if (pick) u.voice = pick;
      u.rate = 0.95; // a touch slower — calm, not chipmunk
      u.pitch = 1.0;
      u.volume = 1.0;
      u.onend = () => setSpeakState("idle");
      u.onerror = () => setSpeakState("error");
      utteranceRef.current = u;
      setSpeakState("speaking");
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn("Pilot morning message failed", e);
      setSpeakState("error");
    }
  }

  function stop() {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakState("idle");
  }

  if (!canSpeak) {
    return (
      <span className="text-[11px] text-gray-500">
        🔊 Spoken version isn&apos;t supported in this browser.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {speakState === "speaking" ? (
        <button
          type="button"
          onClick={stop}
          className="btn min-h-9 text-xs font-semibold bg-gray-800 hover:bg-gray-900 text-white border-gray-900"
        >
          ⏹ Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={play}
          disabled={speakState === "loading"}
          className="btn min-h-9 text-xs font-semibold bg-[#0b1a33] hover:bg-[#1a2c4f] text-white border-[#0b1a33] disabled:opacity-60"
          title="Hear today's note read aloud by your browser's voice."
        >
          {speakState === "loading" ? "Loading…" : "🔊 Listen"}
        </button>
      )}
      <span className="text-[10px] text-gray-400">
        {aiOn ? "Personalised for you" : "Read aloud in your browser"}
      </span>
      {speakState === "error" && (
        <span className="text-[11px] text-red-700">Couldn&apos;t play — try again.</span>
      )}
    </div>
  );
}

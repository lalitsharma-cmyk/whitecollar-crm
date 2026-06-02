"use client";
// AIMotivatorCard — Lalit's brief (verbatim):
//   "For each agent, there should be AI who analyses everything in agent
//    dashboard and Motivate him yes , You can do it or suggestion for any
//    client , Each day in morning , A recorded voice should be there by
//    Agent which should be like his manager who is motivating him."
//
// Two pieces on one card:
//   1. AI-generated motivation paragraph + one concrete client suggestion
//      (pulled from the agent's hottest untouched lead). Fetched from
//      /api/ai/motivate.
//   2. "🎙 Play morning message" button — fetches /api/ai/morning-message,
//      then speaks it via the browser's window.speechSynthesis (Web Speech
//      API). No server-side TTS needed, no extra dependency. Voice prefers
//      en-IN (Indian-English) when available so the manager voice sounds
//      familiar to a Dubai+India team.
//
// Server-side cache (per-agent, per-day) on both endpoints means a reload
// gets the same message — feels intentional, not flaky.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface MotivatePayload {
  motivation: string;
  suggestionLeadId: string | null;
  suggestionLeadName: string | null;
  suggestionAction: string | null;
  source: "ai" | "rule";
}

type SpeakState = "idle" | "loading" | "speaking" | "error";

export default function AIMotivatorCard() {
  const [data, setData] = useState<MotivatePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speakState, setSpeakState] = useState<SpeakState>("idle");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Fetch motivation on mount. Single GET — server caches per agent per day.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/motivate", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setData(j as MotivatePayload);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load today's motivation.");
      });
    return () => {
      cancelled = true;
      // Cancel any speech in progress when the card unmounts.
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const canSpeak = typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";

  async function playMorningMessage() {
    if (!canSpeak) return;
    setSpeakState("loading");
    try {
      // Cancel any ongoing speech first — defensive, the user might tap twice.
      window.speechSynthesis.cancel();

      const r = await fetch("/api/ai/morning-message", { cache: "no-store" });
      const j = (await r.json()) as { message?: string };
      const text = String(j.message ?? "").trim();
      if (!text) throw new Error("Empty message");

      // Pick the best available voice. Prefer en-IN (Indian English) so the
      // manager voice sounds local. Fallback chain: en-IN → en-GB → en-US →
      // whatever browser picks.
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find((v) => v.lang === "en-IN") ??
        voices.find((v) => v.lang === "en-GB") ??
        voices.find((v) => v.lang.startsWith("en")) ??
        voices[0] ??
        null;

      const u = new SpeechSynthesisUtterance(text);
      if (pick) u.voice = pick;
      u.rate = 0.95;  // slightly slower than default — manager voice, not chipmunk
      u.pitch = 1.0;
      u.volume = 1.0;
      u.onend = () => setSpeakState("idle");
      u.onerror = () => setSpeakState("error");
      utteranceRef.current = u;
      setSpeakState("speaking");
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn("Morning message failed", e);
      setSpeakState("error");
    }
  }

  function stopSpeaking() {
    if (canSpeak) window.speechSynthesis.cancel();
    setSpeakState("idle");
  }

  // Loading skeleton — keeps layout stable so the dashboard doesn't jump.
  if (!data && !loadError) {
    return (
      <div className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/40 to-white">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">🧠</span>
          <div className="font-semibold text-sm">AI coach</div>
          <span className="text-[10px] text-gray-500">Reading your pipeline…</span>
        </div>
        <div className="h-4 bg-gray-100 rounded w-3/4 mb-2 animate-pulse" />
        <div className="h-4 bg-gray-100 rounded w-1/2 animate-pulse" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="card p-4 border-l-4 border-gray-300 bg-gray-50">
        <div className="text-xs text-gray-600">🧠 {loadError} Refresh to retry.</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/50 to-white">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🧠</span>
        <div className="font-semibold text-sm">Your AI coach</div>
        <span className="text-[10px] text-gray-500">
          {data.source === "ai" ? "Generated from your pipeline today" : "Rule-based (set AI key for personalised coaching)"}
        </span>
      </div>

      <div className="text-sm text-[#0b1a33] leading-relaxed">
        <span className="mr-1">💪</span>
        {data.motivation}
      </div>

      {data.suggestionLeadName && data.suggestionLeadId && data.suggestionAction && (
        <Link
          href={`/leads/${data.suggestionLeadId}`}
          className="block mt-3 rounded-lg border-2 border-[#c9a24b] bg-white px-3 py-2 hover:shadow-md transition group"
        >
          <div className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
            Try this today
          </div>
          <div className="text-sm font-semibold text-[#0b1a33] group-hover:underline mt-0.5">
            {data.suggestionLeadName}
          </div>
          <div className="text-xs text-gray-600 mt-0.5">{data.suggestionAction}</div>
        </Link>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canSpeak ? (
          speakState === "speaking" ? (
            <button
              type="button"
              onClick={stopSpeaking}
              className="btn min-h-9 text-xs font-semibold bg-gray-800 hover:bg-gray-900 text-white border-gray-900"
            >
              ⏹ Stop morning message
            </button>
          ) : (
            <button
              type="button"
              onClick={playMorningMessage}
              disabled={speakState === "loading"}
              className="btn min-h-9 text-xs font-semibold bg-[#0b1a33] hover:bg-[#1a2c4f] text-white border-[#0b1a33] disabled:opacity-60"
              title="A 2-3 sentence morning pep-talk in the voice of your manager — played by your browser's voice."
            >
              {speakState === "loading" ? "Loading…" : "🎙 Play morning message"}
            </button>
          )
        ) : (
          <span className="text-[11px] text-gray-500">
            🎙 Morning message: your browser doesn&apos;t support voice playback.
          </span>
        )}
        {speakState === "error" && (
          <span className="text-[11px] text-red-700">Couldn&apos;t play — try again.</span>
        )}
      </div>
    </div>
  );
}

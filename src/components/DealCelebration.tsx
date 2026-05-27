"use client";
// DealCelebration — premium milestone celebrations for sales events.
//
// Imperative API (same pattern as XPToast):
//
//   import { showCelebration } from "@/components/DealCelebration";
//   showCelebration({ kind: "booking_done", message: "Booking done — Ramesh ₹3.2 Cr" });
//
// Mount <DealCelebrationHost /> once near the root (we do this in
// MobileShell).
//
// Kinds:
//   • booking_done       → BIG centered overlay, gold burst, 2-tone synth ding, 5s
//   • meeting_booked     → bottom-center toast, 3s
//   • site_visit_done    → bottom-center toast, 3s
//   • cold_to_lead       → bottom-center toast, 3s
//
// Luxury aesthetic — NO confetti, NO childish bouncing. Slow gold gradient
// burst + slow fade. Audio is a short dignified 2-tone chime via Web Audio
// (only on the BIG one).

import { useEffect, useState } from "react";

export type CelebrationKind =
  | "meeting_booked"
  | "site_visit_done"
  | "cold_to_lead"
  | "booking_done"
  | "all_missions_done";

interface CelebrationPayload {
  kind: CelebrationKind;
  message: string;
}

const EVENT_NAME = "wcr:deal-celebration";

export function showCelebration(payload: CelebrationPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

interface CelebrationItem extends CelebrationPayload {
  id: number;
}

let nextId = 1;

// Small-toast kinds get an emoji prefix; the big one renders its own header.
const SMALL_META: Record<
  Exclude<CelebrationKind, "booking_done" | "all_missions_done">,
  { emoji: string; label: string }
> = {
  meeting_booked:  { emoji: "📅", label: "Meeting booked" },
  site_visit_done: { emoji: "🏠", label: "Site visit done" },
  cold_to_lead:    { emoji: "🔥", label: "Revived to lead" },
};

// Play a short, dignified 2-tone "ding". Two sine notes, ~120ms each, a
// fifth apart. Best-effort — silently no-ops if Web Audio is unavailable
// or blocked by the browser's autoplay policy.
function playSuccessChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Gentle attack/decay envelope so it doesn't click.
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
    };

    // C6 then G6 — clean rising fifth, restrained.
    playTone(1046.5, now,         0.12);
    playTone(1568.0, now + 0.13,  0.14);

    // Close the context after the chime finishes to free resources.
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 500);
  } catch {
    // Audio is best-effort; never throw into the UI tree.
  }
}

export default function DealCelebrationHost() {
  const [items, setItems] = useState<CelebrationItem[]>([]);

  useEffect(() => {
    function onEvent(e: Event) {
      const ce = e as CustomEvent<CelebrationPayload>;
      const p = ce.detail;
      if (!p || typeof p.message !== "string" || !p.kind) return;
      const id = nextId++;
      setItems((prev) => [...prev, { ...p, id }]);
      const ttl =
        p.kind === "booking_done"
          ? 5000
          : p.kind === "all_missions_done"
            ? 4000
            : 3000;
      if (p.kind === "booking_done") playSuccessChime();
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    }
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, []);

  if (items.length === 0) return null;

  const big = items.filter((i) => i.kind === "booking_done");
  const small = items.filter(
    (i) => i.kind !== "booking_done" && i.kind !== "all_missions_done",
  );
  const missionsDone = items.filter((i) => i.kind === "all_missions_done");

  return (
    <>
      {/* ── BIG: centered overlay for booking_done ── */}
      {big.length > 0 && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none"
          aria-live="assertive"
        >
          {big.map((t) => (
            <BookingDoneOverlay key={t.id} message={t.message} />
          ))}
        </div>
      )}

      {/* ── SMALL: bottom-center toasts for the other kinds ── */}
      {(small.length > 0 || missionsDone.length > 0) && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none"
          style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
          aria-live="polite"
        >
          {missionsDone.map((t) => (
            <AllMissionsDonePill key={t.id} message={t.message} />
          ))}
          {small.map((t) => (
            <SmallToast key={t.id} item={t} />
          ))}
        </div>
      )}

      <style>{`
        @keyframes wcr-celeb-small-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wcr-celeb-small { animation: wcr-celeb-small-in 260ms ease-out; }

        @keyframes wcr-celeb-big-in {
          0%   { opacity: 0; transform: scale(0.92); }
          40%  { opacity: 1; }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes wcr-celeb-big-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        .wcr-celeb-big {
          animation:
            wcr-celeb-big-in 420ms cubic-bezier(.16,.84,.32,1) both,
            wcr-celeb-big-out 1.2s ease-in 3.8s both;
        }

        /* Slow radial gold burst behind the card — expands and fades. */
        @keyframes wcr-celeb-burst {
          0%   { opacity: 0; transform: scale(0.4); }
          30%  { opacity: 0.85; }
          100% { opacity: 0; transform: scale(2.2); }
        }
        .wcr-celeb-burst {
          animation: wcr-celeb-burst 2.4s ease-out both;
        }

        /* Subtle shimmer sweep across the card's gold border. */
        @keyframes wcr-celeb-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .wcr-celeb-shimmer {
          background: linear-gradient(
            90deg,
            rgba(201,162,75,0) 0%,
            rgba(201,162,75,0.55) 50%,
            rgba(201,162,75,0) 100%
          );
          background-size: 200% 100%;
          animation: wcr-celeb-shimmer 2.2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}

function BookingDoneOverlay({ message }: { message: string }) {
  return (
    <div className="wcr-celeb-big relative pointer-events-auto">
      {/* Radial gold burst behind the card */}
      <div
        className="wcr-celeb-burst absolute inset-0 -m-32 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(201,162,75,0.55) 0%, rgba(201,162,75,0.15) 45%, rgba(201,162,75,0) 70%)",
          pointerEvents: "none",
        }}
      />

      {/* The card itself — deep navy with gold trim */}
      <div
        className="relative rounded-2xl px-8 py-7 sm:px-12 sm:py-9 max-w-[92vw] min-w-[280px] text-center shadow-2xl border-2"
        style={{
          background:
            "linear-gradient(135deg, #0b1a33 0%, #152d57 55%, #0b1a33 100%)",
          borderColor: "var(--accent-primary, #c9a24b)",
          color: "#fff",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(201,162,75,0.35), 0 0 80px rgba(201,162,75,0.25)",
        }}
      >
        {/* Shimmer bar across the top */}
        <div
          className="wcr-celeb-shimmer absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl"
          aria-hidden
        />

        <div
          className="text-[10px] sm:text-[11px] uppercase tracking-[0.35em] font-bold"
          style={{ color: "var(--accent-primary, #c9a24b)" }}
        >
          Milestone
        </div>
        <div
          className="text-2xl sm:text-3xl font-extrabold mt-2"
          style={{
            color: "var(--accent-primary, #c9a24b)",
            textShadow: "0 0 24px rgba(201,162,75,0.45)",
            letterSpacing: "0.02em",
          }}
        >
          🎉 BOOKING DONE
        </div>
        <div className="text-sm sm:text-base text-white/90 mt-3 leading-snug">
          {message}
        </div>
      </div>
    </div>
  );
}

function AllMissionsDonePill({ message }: { message: string }) {
  return (
    <div
      className="wcr-celeb-small pointer-events-auto rounded-full shadow-lg border-2 px-5 py-2.5 flex items-center gap-2.5 max-w-[92vw]"
      style={{
        background:
          "linear-gradient(135deg, #0b1a33 0%, #152d57 55%, #0b1a33 100%)",
        borderColor: "var(--accent-primary, #c9a24b)",
        color: "#fff",
        boxShadow:
          "0 10px 30px rgba(0,0,0,0.35), 0 0 0 1px rgba(201,162,75,0.35), 0 0 40px rgba(201,162,75,0.25)",
      }}
    >
      <span className="text-base leading-none" aria-hidden>
        🎯
      </span>
      <div className="text-xs leading-tight">
        <div
          className="font-bold tracking-wide"
          style={{ color: "var(--accent-primary, #c9a24b)" }}
        >
          All daily missions complete — well done!
        </div>
        <div className="text-white/85 truncate max-w-[260px]">
          {message}
        </div>
      </div>
    </div>
  );
}

function SmallToast({ item }: { item: CelebrationItem }) {
  if (item.kind === "booking_done" || item.kind === "all_missions_done") {
    return null; // handled elsewhere
  }
  const meta = SMALL_META[item.kind];
  return (
    <div
      className="wcr-celeb-small pointer-events-auto rounded-full shadow-lg border px-4 py-2 flex items-center gap-2.5 max-w-[92vw]"
      style={{
        background:
          "linear-gradient(135deg, #0b1a33 0%, #152d57 100%)",
        borderColor: "var(--accent-primary, #c9a24b)",
        color: "#fff",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(201,162,75,0.25)",
      }}
    >
      <span className="text-lg leading-none" aria-hidden>
        {meta.emoji}
      </span>
      <div className="text-xs leading-tight">
        <div
          className="font-bold tracking-wide"
          style={{ color: "var(--accent-primary, #c9a24b)" }}
        >
          {meta.label}
        </div>
        <div className="text-white/85 truncate max-w-[260px]">
          {item.message}
        </div>
      </div>
    </div>
  );
}

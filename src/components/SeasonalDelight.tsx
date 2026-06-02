"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveFestival,
  type DelightKind,
  type Festival,
} from "@/lib/festivals";

/**
 * SeasonalDelight — tasteful floating festival decorations + ONE lightweight
 * interactive easter-egg, layered over the whole app.
 *
 * Lalit's ask: "not only colours — floating diya on Diwali, floating teacher on
 * Teacher's Day, interactive games."
 *
 * What it does:
 *   • When a festival is active (date-driven) OR force-previewed via
 *     `?festive=diwali` etc., it renders a set of slowly drifting emoji
 *     elements appropriate to the festival (diya 🪔 + sparkles for Diwali,
 *     graduation cap 🎓 + apple 🍎 for Teacher's Day, snow ❄️ for Christmas …).
 *   • A single floating "easter-egg" target the user can tap/click for a fun
 *     micro-reaction (taps burst into sparkles + a small "+1" counter). It is
 *     dismissible and stays out of the way (bottom corner, above the bottom
 *     nav's safe area).
 *
 * Hard constraints honoured:
 *   • The decorative layer is `pointer-events-none` and sits at a LOW z-index
 *     (below the bottom nav z-30, drawer z-40/50, modals z-50+, and the deal
 *     celebration overlays z-100+) so it never blocks the UI or covers modals.
 *   • Only the intentional easter-egg button is `pointer-events-auto`.
 *   • Respects `prefers-reduced-motion`: motion is disabled and we render a
 *     minimal, static accent instead of drifting/falling animation.
 *   • No layout shift (fixed, inset-0), no heavy CPU (pure CSS keyframes,
 *     small element counts, capped emoji bursts), mobile-safe sizing.
 *
 * Rendered from inside FestiveBanner.tsx (already mounted globally in the
 * shell) so no shell edit is needed.
 */

const DISMISS_PREFIX = "wcr.delightDismissed.";
const PREF_KEY = "wcr.festiveModeEnabled";

/** A single drifting/falling decorative element's static layout config. */
interface FloatItem {
  /** Emoji glyph. */
  ch: string;
  /** Horizontal position, vw. */
  left: number;
  /** Animation duration, seconds (slow = calm). */
  dur: number;
  /** Negative animation delay, seconds, so they don't all start together. */
  delay: number;
  /** Font size, rem. */
  size: number;
  /** Peak opacity (kept low so text stays readable underneath). */
  opacity: number;
  /** Which keyframe family to use. */
  motion: "fall" | "drift" | "rise";
  /** Subtle horizontal sway amplitude, px. */
  sway: number;
}

/** Emoji palette + default motion per festival pack. */
const PACKS: Record<DelightKind, { glyphs: string[]; motion: FloatItem["motion"] }> = {
  diwali:    { glyphs: ["🪔", "✨", "🪔", "🎆", "✨"], motion: "drift" },
  holi:      { glyphs: ["🎨", "🌈", "💜", "💛", "💚", "❤️"], motion: "rise" },
  teachers:  { glyphs: ["🎓", "🍎", "📚", "✏️", "🎓"], motion: "drift" },
  newyear:   { glyphs: ["🎆", "🎉", "✨", "🥂", "🎇"], motion: "rise" },
  christmas: { glyphs: ["❄️", "🎄", "⭐", "❄️", "🎁"], motion: "fall" },
  eid:       { glyphs: ["🌙", "✨", "🏮", "⭐", "🌙"], motion: "drift" },
  national:  { glyphs: ["🎉", "✨", "🎊", "⭐"], motion: "rise" },
  sparkle:   { glyphs: ["✨", "⭐", "✨"], motion: "drift" },
};

/** The tappable easter-egg target glyph per pack. */
const EGG_GLYPH: Record<DelightKind, string> = {
  diwali:    "🪔",
  holi:      "🎨",
  teachers:  "🎓",
  newyear:   "🎆",
  christmas: "🎁",
  eid:       "🏮",
  national:  "🎉",
  sparkle:   "✨",
};

/** Short label shown when the easter-egg is first noticed. */
const EGG_HINT: Record<DelightKind, string> = {
  diwali:    "Tap to light a diya",
  holi:      "Tap for colours",
  teachers:  "Tap to say thanks",
  newyear:   "Tap for fireworks",
  christmas: "Tap to unwrap",
  eid:       "Tap the lantern",
  national:  "Tap to celebrate",
  sparkle:   "Tap me",
};

/** Burst glyphs emitted when the easter-egg is tapped. */
const BURST_GLYPH: Record<DelightKind, string[]> = {
  diwali:    ["✨", "🪔", "⭐"],
  holi:      ["💜", "💛", "💚", "❤️", "🧡", "💙"],
  teachers:  ["🍎", "⭐", "📖"],
  newyear:   ["🎉", "✨", "🎊"],
  christmas: ["❄️", "⭐", "🎀"],
  eid:       ["✨", "🌙", "⭐"],
  national:  ["🎉", "✨", "🎊"],
  sparkle:   ["✨", "⭐"],
};

interface Burst {
  id: number;
  ch: string;
  /** angle in deg around the egg */
  angle: number;
  /** travel distance px */
  dist: number;
}

let burstSeq = 1;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Deterministic-ish pseudo random in [0,1) from an integer seed. */
function rand(seed: number): number {
  const x = Math.sin(seed * 99.13 + 7.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Build the static list of floating items for a pack (count depends on motion). */
function buildItems(kind: DelightKind, count: number): FloatItem[] {
  const pack = PACKS[kind] ?? PACKS.sparkle;
  const items: FloatItem[] = [];
  for (let i = 0; i < count; i++) {
    const r1 = rand(i + 1);
    const r2 = rand(i + 101);
    const r3 = rand(i + 211);
    const r4 = rand(i + 307);
    items.push({
      ch: pack.glyphs[i % pack.glyphs.length],
      left: Math.round(r1 * 96) + 2, // 2vw..98vw
      dur: 16 + Math.round(r2 * 18), // 16s..34s — slow & calm
      delay: -Math.round(r3 * 30), // negative so mid-flight at mount
      size: 1.1 + r4 * 1.4, // 1.1rem..2.5rem
      opacity: 0.14 + rand(i + 401) * 0.16, // 0.14..0.30 — subtle
      motion: pack.motion,
      sway: 8 + Math.round(rand(i + 503) * 22), // 8px..30px
    });
  }
  return items;
}

export default function SeasonalDelight() {
  const [festival, setFestival] = useState<Festival | null>(null);
  const [eggDismissed, setEggDismissed] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [taps, setTaps] = useState(0);
  const [pulse, setPulse] = useState(false);
  const reduced = useReducedMotion();
  const eggRef = useRef<HTMLButtonElement>(null);

  // Resolve the active festival on mount (client only — respects ?festive=).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(PREF_KEY) === "false") return; // festive mode muted
    const active = getActiveFestival();
    if (!active) return;
    setFestival(active);
    try {
      setEggDismissed(localStorage.getItem(DISMISS_PREFIX + active.id) === "true");
    } catch {
      /* storage disabled — keep egg visible */
    }
  }, []);

  const kind: DelightKind = festival?.delight ?? "sparkle";

  // Fewer elements when motion is reduced (we also freeze them via CSS below).
  const count = reduced ? 5 : kind === "christmas" || kind === "holi" ? 16 : 12;
  const items = useMemo(() => buildItems(kind, count), [kind, count]);

  function dismissEgg() {
    setEggDismissed(true);
    if (festival) {
      try {
        localStorage.setItem(DISMISS_PREFIX + festival.id, "true");
      } catch {
        /* ignore */
      }
    }
  }

  function tapEgg() {
    setTaps((t) => t + 1);
    setPulse(true);
    window.setTimeout(() => setPulse(false), 320);

    // Emit a small capped burst of glyphs from the egg.
    const glyphs = BURST_GLYPH[kind] ?? BURST_GLYPH.sparkle;
    const n = reduced ? 3 : 7;
    const fresh: Burst[] = [];
    for (let i = 0; i < n; i++) {
      fresh.push({
        id: burstSeq++,
        ch: glyphs[i % glyphs.length],
        angle: (360 / n) * i + Math.round(rand(burstSeq) * 40 - 20),
        dist: reduced ? 26 : 44 + Math.round(rand(burstSeq + 9) * 36),
      });
    }
    setBursts((prev) => [...prev, ...fresh]);
    const ids = new Set(fresh.map((f) => f.id));
    window.setTimeout(() => {
      setBursts((prev) => prev.filter((b) => !ids.has(b.id)));
    }, 900);

    // Light chime is intentionally omitted — keep it silent & non-intrusive.
  }

  if (!festival) return null;

  return (
    <>
      {/* ── Decorative drifting layer — pointer-events-none, low z, behind
            modals/nav. aria-hidden so it's invisible to screen readers. ── */}
      <div
        className="wcr-delight-layer pointer-events-none fixed inset-0 overflow-hidden z-[5]"
        aria-hidden
        data-reduced={reduced ? "true" : "false"}
      >
        {items.map((it, i) => (
          <span
            key={i}
            className={`wcr-delight-item wcr-delight-${it.motion}`}
            style={{
              left: `${it.left}vw`,
              fontSize: `${it.size}rem`,
              ["--wcr-dur" as string]: `${it.dur}s`,
              ["--wcr-delay" as string]: `${it.delay}s`,
              ["--wcr-opacity" as string]: it.opacity,
              ["--wcr-sway" as string]: `${it.sway}px`,
            }}
          >
            {it.ch}
          </span>
        ))}
      </div>

      {/* ── Interactive easter-egg — the ONLY pointer-events-auto element. Sits
            in the bottom-left corner, above the iPhone home-indicator safe
            area, and below the mobile bottom nav so it doesn't crowd actions.
            Dismissible. ── */}
      {!eggDismissed && (
        <div
          className="fixed left-3 z-[35] flex flex-col items-center select-none"
          style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
        >
          {/* Burst particles */}
          <div className="relative">
            {bursts.map((b) => (
              <span
                key={b.id}
                className="wcr-delight-burst pointer-events-none absolute left-1/2 top-1/2 text-base"
                style={{
                  ["--wcr-angle" as string]: `${b.angle}deg`,
                  ["--wcr-dist" as string]: `${b.dist}px`,
                }}
              >
                {b.ch}
              </span>
            ))}

            <button
              ref={eggRef}
              type="button"
              onClick={tapEgg}
              aria-label={`${festival.name} — ${EGG_HINT[kind]} (tap for a surprise)`}
              title={EGG_HINT[kind]}
              className={`wcr-delight-egg pointer-events-auto relative w-12 h-12 rounded-full flex items-center justify-center text-2xl shadow-lg border ${
                pulse ? "wcr-delight-egg-pulse" : ""
              }`}
              style={{
                background: "var(--bg-card, #fff)",
                borderColor: "var(--accent-primary, #c9a24b)",
                boxShadow:
                  "0 6px 20px rgba(0,0,0,0.25), 0 0 0 1px var(--accent-primary, #c9a24b)",
              }}
            >
              <span aria-hidden>{EGG_GLYPH[kind]}</span>
            </button>
          </div>

          {/* Tap counter — only appears after the first tap. */}
          {taps > 0 && (
            <div
              className="mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: "var(--accent-primary, #c9a24b)",
                color: "#0b1a33",
              }}
              aria-live="polite"
            >
              +{taps} {kind === "diwali" ? "light" : kind === "teachers" ? "thanks" : "cheer"}
              {taps > 1 ? "s" : ""}
            </div>
          )}

          {/* Tiny dismiss affordance. */}
          <button
            type="button"
            onClick={dismissEgg}
            aria-label="Hide festive surprise"
            className="mt-1 text-[10px] leading-none px-1.5 py-0.5 rounded-full opacity-70 hover:opacity-100"
            style={{ background: "var(--bg-muted, #f1f2f6)", color: "var(--text-muted, #6b7280)" }}
          >
            ✕ hide
          </button>
        </div>
      )}

      {/* Scoped animation styles. All motion is gated behind
          prefers-reduced-motion via the [data-reduced] attribute + a global
          media query so reduced-motion users get a static, low-opacity scene. */}
      <style>{`
        .wcr-delight-item {
          position: absolute;
          top: -10%;
          opacity: var(--wcr-opacity, 0.2);
          will-change: transform;
          user-select: none;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.12));
        }

        /* FALL — top to bottom (snow, gifts). */
        @keyframes wcr-fall {
          0%   { transform: translateY(-12vh) translateX(0) rotate(0deg); }
          50%  { transform: translateY(45vh) translateX(var(--wcr-sway, 16px)) rotate(180deg); }
          100% { transform: translateY(112vh) translateX(0) rotate(360deg); }
        }
        /* RISE — bottom to top (fireworks, colour, cheer). */
        @keyframes wcr-rise {
          0%   { transform: translateY(112vh) translateX(0) rotate(0deg); }
          50%  { transform: translateY(45vh) translateX(calc(var(--wcr-sway, 16px) * -1)) rotate(-10deg); }
          100% { transform: translateY(-12vh) translateX(0) rotate(8deg); }
        }
        /* DRIFT — gentle vertical bob + sway (diya, moons, caps). */
        @keyframes wcr-drift {
          0%   { transform: translateY(110vh) translateX(0) rotate(-4deg); }
          50%  { transform: translateY(40vh) translateX(var(--wcr-sway, 16px)) rotate(4deg); }
          100% { transform: translateY(-12vh) translateX(0) rotate(-4deg); }
        }

        .wcr-delight-layer[data-reduced="false"] .wcr-delight-fall {
          animation: wcr-fall var(--wcr-dur, 22s) linear var(--wcr-delay, 0s) infinite;
        }
        .wcr-delight-layer[data-reduced="false"] .wcr-delight-rise {
          animation: wcr-rise var(--wcr-dur, 22s) linear var(--wcr-delay, 0s) infinite;
        }
        .wcr-delight-layer[data-reduced="false"] .wcr-delight-drift {
          animation: wcr-drift var(--wcr-dur, 22s) ease-in-out var(--wcr-delay, 0s) infinite;
        }

        /* Reduced motion: freeze elements scattered & faint, no animation. */
        .wcr-delight-layer[data-reduced="true"] .wcr-delight-item {
          top: 30%;
          opacity: calc(var(--wcr-opacity, 0.2) * 0.7);
          animation: none !important;
        }

        /* Easter-egg gentle idle bob (disabled under reduced motion). */
        @keyframes wcr-egg-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        .wcr-delight-egg { animation: wcr-egg-bob 3.2s ease-in-out infinite; }
        .wcr-delight-egg-pulse { animation: wcr-egg-pop 320ms ease-out; }
        @keyframes wcr-egg-pop {
          0%   { transform: scale(1); }
          40%  { transform: scale(1.18); }
          100% { transform: scale(1); }
        }

        /* Burst particles fly outward + fade. */
        @keyframes wcr-burst {
          0%   { opacity: 1; transform: translate(-50%, -50%) rotate(var(--wcr-angle)) translateX(0) scale(0.8); }
          100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--wcr-angle)) translateX(var(--wcr-dist, 44px)) scale(1.15); }
        }
        .wcr-delight-burst {
          animation: wcr-burst 850ms ease-out forwards;
        }

        @media (prefers-reduced-motion: reduce) {
          .wcr-delight-item { animation: none !important; }
          .wcr-delight-egg { animation: none !important; }
          .wcr-delight-egg-pulse { animation: none !important; }
          .wcr-delight-burst { animation: wcr-burst-fade 600ms ease-out forwards; }
          @keyframes wcr-burst-fade {
            0%   { opacity: 0.9; transform: translate(-50%, -50%) rotate(var(--wcr-angle)) translateX(0); }
            100% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--wcr-angle)) translateX(var(--wcr-dist, 26px)); }
          }
        }
      `}</style>
    </>
  );
}

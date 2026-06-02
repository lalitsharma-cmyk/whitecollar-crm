// MotivationPilot — B-20 (P4), Bucket H "voice / motivation surface".
//
// WHY THIS EXISTS (read before mounting):
//   The voice + daily-motivation idea (see docs/SPEC-smart-cma-and-voice.md
//   Part 2, plus the existing AIMotivatorCard / morning-message work) is
//   PARTIALLY SPECCED but NOT validated for tone or usefulness on a real
//   sales floor. Per the bug report (B-20) the agreed path is: pilot with ONE
//   team first, gated and off-by-default, before any global rollout. This
//   component is that safe pilot — a tasteful, self-contained surface that
//   renders for exactly one team and only when an admin has switched the
//   pilot on. Everywhere else it renders NOTHING.
//
// GATING (both must be true, else returns null):
//   1. motivationPilot.enabled === "true"   (admin master switch, default OFF)
//   2. the viewer's User.team matches motivationPilot.team  (case-insensitive)
//   Team is read from the user's existing `team` field ONLY — never inferred
//   from phone number or geography. See isMotivationPilotViewer() in settings.
//
// AI POSTURE:
//   AI is currently OFF in production (no GEMINI/ANTHROPIC key → aiEnabled()
//   is false). This surface NEVER calls an AI/external API itself and adds no
//   dependency. The daily line is deterministic, tasteful copy from the
//   existing salesQuotes module. When/if a key is set, aiEnabled() flips true
//   and we simply show a small "personalised coaching available" note pointing
//   at the already-built /api/ai/* endpoints — we do not generate here. This
//   keeps the pilot cheap, predictable, and reviewable for tone.
//
// This is a SERVER component (async): it does the gating server-side using the
// settings helpers + prisma-backed Setting rows, then passes only serializable
// props down to the small client child that owns the optional voice playback.
// The coordinator mounts it — this file does NOT mount itself anywhere.

import "server-only";
import { isMotivationPilotViewer } from "@/lib/settings";
import { aiEnabled } from "@/lib/ai";
import { quoteOfTheDay } from "@/lib/salesQuotes";
import MotivationPilotVoice from "@/components/MotivationPilotVoice";

export interface MotivationPilotProps {
  /**
   * The viewer's identity, read by the caller from the authenticated User
   * record. `team` MUST come from the existing User.team field — do not pass a
   * value derived from phone/geography. Pass the user's first name (or full
   * name) for a warmer greeting; optional.
   */
  viewer: {
    name?: string | null;
    /** From User.team — "Dubai" / "India" / "HQ" / null. */
    team?: string | null;
  };
}

/**
 * Renders the one-team motivation/voice pilot surface, or `null` when the
 * viewer is not in scope. Safe to mount unconditionally on a shared page —
 * the gating lives entirely inside.
 */
export default async function MotivationPilot({ viewer }: MotivationPilotProps) {
  // Hard gate: off-by-default + team-scoped. Returns false unless the pilot is
  // ON and the viewer's own team matches the configured pilot team.
  const eligible = await isMotivationPilotViewer(viewer.team);
  if (!eligible) return null;

  const firstName = (viewer.name ?? "").trim().split(/\s+/)[0] || "there";
  const quote = quoteOfTheDay();
  // aiEnabled() is server-only; resolve it here and pass a plain boolean down.
  const aiOn = aiEnabled();

  // A calm, professional greeting. No hype, no pressure — this is a real
  // workplace and the whole point of the pilot is to judge whether the tone
  // lands before it goes wider.
  const greeting = `Good morning, ${firstName}. Here's a small nudge to start the day.`;

  return (
    <section
      className="card p-4 border-l-4 border-[#c9a24b] bg-gradient-to-br from-amber-50/40 to-white"
      aria-label="Daily motivation (pilot)"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg" aria-hidden>
          ☕
        </span>
        <div className="font-semibold text-sm text-[#0b1a33]">Daily note</div>
        <span className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
          Pilot
        </span>
      </div>

      <p className="text-sm text-[#0b1a33] leading-relaxed">{greeting}</p>

      <blockquote className="mt-2 border-l-2 border-[#e5e7eb] pl-3">
        <p className="text-sm text-gray-800 italic">&ldquo;{quote.text}&rdquo;</p>
        <footer className="text-[11px] text-gray-500 mt-0.5">— {quote.author}</footer>
      </blockquote>

      {/* Optional spoken version. The client child owns the Web Speech API and
          degrades to a quiet note where the browser can't speak. It fetches the
          already-built /api/ai/morning-message endpoint, which itself falls
          back to a tasteful rule-based line when AI is off. */}
      <div className="mt-3">
        <MotivationPilotVoice aiOn={aiOn} />
      </div>

      <p className="mt-3 text-[10px] text-gray-400 leading-snug">
        Pilot feature shown to your team only. Tell {`Lalit`} if the tone feels
        off or unhelpful — that feedback decides whether it rolls out wider.
      </p>
    </section>
  );
}

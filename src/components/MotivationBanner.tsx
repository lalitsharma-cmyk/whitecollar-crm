"use client";
// ────────────────────────────────────────────────────────────────────────────
// MotivationBanner — a compact, premium, rotating motivational strip that sits
// ABOVE the Leads filter/table area (Leads page only). Purely presentational:
// NO business logic, NO data fetch, NO permissions. It just rotates a short,
// personalised pep-line for whoever is logged in.
//
// WHY A CLIENT ISLAND (matches DashboardGreeting): the logged-in user's first
// name is resolved on the server (the Leads page already has `me`) and passed
// in as a plain serializable string — the component never fetches. The rotation
// is a tiny browser-side interval that fades to the next message every 7s and
// is torn down on unmount (no leak, no heavy re-render — this island re-renders
// in isolation and never touches the table/filters below it).
//
// DESIGN: soft champagne→navy gradient card that follows the CRM theme tokens,
// so it reads as a premium accent in Light, Dark, and System themes:
//   • Light: faint gold/navy wash on white, navy ink — high contrast, soft.
//   • Dark : translucent gold/navy over the card surface, light ink — the same
//            translucent-over-navy recipe the rest of the dark UI uses (see
//            globals.css), so no muddy colours and AA-readable contrast.
// One line tall, full width, text truncates on narrow screens, carousel dots on
// the right. Honours prefers-reduced-motion (no slide; instant swap).
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/** Message templates. {name} is substituted with the user's first name. Kept as
 *  a module constant so it is created once, not per render. */
const MESSAGES = [
  "Hi {name} 👋 Weekend is here! Perfect time to meet more clients — schedule more Site Visits & Meetings.",
  "Hi {name} 💪 June is almost over. Let's close this month strong — more meetings, more deals.",
  "Hi {name} 🚀 Weekend opportunity! More Site Visits = More Conversions.",
  "Hi {name} 🏆 End of June — let's make it our best one yet.",
  "Hi {name} 📅 Plan today's follow-ups and convert them into meetings.",
] as const;

const ROTATE_MS = 7000;

export default function MotivationBanner({ firstName }: { firstName: string }) {
  // Trim + fall back so we never render "Hi  👋" if the name is empty.
  const name = (firstName || "").trim() || "there";
  const [idx, setIdx] = useState(0);
  // Drives the fade/slide: we briefly mark the line "leaving", swap text, then
  // mark it "entering" so the CSS transition animates in. Reduced-motion users
  // skip the visual transition entirely.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let swapTimer: ReturnType<typeof setTimeout> | undefined;

    const id = setInterval(() => {
      if (reduce) {
        // No animation — just swap the text.
        setIdx((i) => (i + 1) % MESSAGES.length);
        return;
      }
      // Fade/slide out → swap text → fade/slide in.
      setVisible(false);
      swapTimer = setTimeout(() => {
        setIdx((i) => (i + 1) % MESSAGES.length);
        setVisible(true);
      }, 300); // matches the 300ms CSS transition below
    }, ROTATE_MS);

    return () => {
      clearInterval(id);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, []);

  const text = MESSAGES[idx].replace("{name}", name);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        "relative flex items-center gap-3 overflow-hidden",
        "rounded-xl px-3.5 py-2.5 sm:px-4",
        "border border-[#ead9b0] dark:border-[#3a486a]",
        // Soft champagne→navy gradient. The arbitrary hex values are immune to
        // the globals.css blue/gold accent overrides, keeping the wash subtle in
        // both themes; dark variant uses translucent navy so it sits on the
        // card surface without muddiness.
        "bg-gradient-to-r from-[#fbf3df] via-[#fdf8ec] to-[#f3f6fb]",
        "dark:from-[#1a2438] dark:via-[#15203a] dark:to-[#111a2e]",
        "shadow-sm",
      ].join(" ")}
    >
      {/* Leading icon — champagne gold, in a soft rounded chip. */}
      <span
        aria-hidden="true"
        className="flex-none inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[#c9a24b]/15 dark:bg-[#d9b765]/15 text-[#9c7a2e] dark:text-[#d9b765]"
      >
        <Sparkles className="w-4 h-4" />
      </span>

      {/* Rotating line — single line, truncates on narrow screens. The fade/slide
          is a cheap opacity+translate transition toggled by `visible`. */}
      <p
        className={[
          "min-w-0 flex-1 truncate text-sm font-semibold",
          "text-[#0b1a33] dark:text-[#e8edf5]",
          "transition-all duration-300 ease-out",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
        ].join(" ")}
        title={text}
      >
        {text}
      </p>

      {/* Carousel dots — current message highlighted in brand gold. Hidden on the
          smallest screens to protect the one-line height for the message. */}
      <div className="hidden sm:flex flex-none items-center gap-1.5" aria-hidden="true">
        {MESSAGES.map((_, i) => (
          <span
            key={i}
            className={[
              "rounded-full transition-all duration-300",
              i === idx
                ? "w-4 h-1.5 bg-[#c9a24b] dark:bg-[#d9b765]"
                : "w-1.5 h-1.5 bg-[#c9a24b]/30 dark:bg-[#d9b765]/30",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}

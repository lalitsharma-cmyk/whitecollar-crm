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

const ROTATE_MS = 7000;

/** Evergreen fallback — always valid, date-independent. Used for the deterministic
 *  first (SSR + hydration) render so there is NO React #418 text mismatch; the
 *  date/context set is computed client-side in useEffect after mount. */
function fallbackLine(name: string): string {
  return `Hi ${name} ✨ Stay focused — today's follow-ups can become tomorrow's closures.`;
}

/** Build the rotating set from LIVE date/context + team. No hardcoded month names —
 *  every line is derived from `now` (browser-local ≈ IST) so it is never stale. */
function buildMessages(name: string, team: string | null, now: Date): string[] {
  const day = now.getDate();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const msgs: string[] = [];

  // ── Month phase ──
  if (day <= 5) msgs.push(`Hi ${name} 🌅 New month started — fresh targets, fresh energy.`);
  else if (day >= daysInMonth - 4) msgs.push(`Hi ${name} 🏁 Month-end push — close strong.`);
  else msgs.push(`Hi ${name} 💪 Keep pushing — every lead can become revenue.`);

  // ── Week phase ──
  if (dow === 1) msgs.push(`Hi ${name} 📅 New week started — plan calls, follow-ups, and meetings.`);
  if (dow === 4 || dow === 5) msgs.push(`Hi ${name} 🗓 Weekend is approaching — schedule more meetings and site visits.`);

  // ── Team / market flavour ──
  const t = (team || "").trim().toLowerCase();
  if (t === "india" || t === "gurgaon" || t === "gurugram")
    msgs.push(`Hi ${name} 🇮🇳 India team — every Gurgaon follow-up moves the revenue needle.`);
  else if (t === "dubai" || t === "uae")
    msgs.push(`Hi ${name} 🇦🇪 Dubai team — more site visits, more AED closings.`);
  else
    msgs.push(`Hi ${name} 🌍 India + Dubai — steady follow-ups across both markets win the month.`);

  // Always include the evergreen line so the rotation never feels repetitive.
  msgs.push(fallbackLine(name));
  return msgs;
}

export default function MotivationBanner({ firstName, team = null }: { firstName: string; team?: string | null }) {
  // Trim + fall back so we never render "Hi  ✨" if the name is empty.
  const name = (firstName || "").trim() || "there";
  // Deterministic initial state (fallback only) → SSR == first client render → no
  // hydration mismatch. useEffect swaps in the live date/context set after mount.
  const [messages, setMessages] = useState<string[]>(() => [fallbackLine(name)]);
  const [idx, setIdx] = useState(0);
  // Drives the fade/slide: we briefly mark the line "leaving", swap text, then
  // mark it "entering" so the CSS transition animates in. Reduced-motion users
  // skip the visual transition entirely.
  const [visible, setVisible] = useState(true);

  // Swap in the live date/context set after mount (client-only → no SSR mismatch).
  useEffect(() => {
    setMessages(buildMessages(name, team, new Date()));
    setIdx(0);
  }, [name, team]);

  useEffect(() => {
    const count = messages.length;
    if (count <= 1) return; // nothing to rotate yet (SSR fallback)
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      if (reduce) {
        setIdx((i) => (i + 1) % count);
        return;
      }
      setVisible(false);
      swapTimer = setTimeout(() => {
        setIdx((i) => (i + 1) % count);
        setVisible(true);
      }, 300); // matches the 300ms CSS transition below
    }, ROTATE_MS);

    return () => {
      clearInterval(id);
      if (swapTimer) clearTimeout(swapTimer);
    };
  }, [messages.length]);

  const text = messages[idx] ?? messages[0];

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
        {messages.map((_, i) => (
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

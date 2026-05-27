"use client";

import { useEffect, useState } from "react";

/**
 * Lightweight 4-step onboarding tour for first-time users.
 *
 * Renders nothing if the user has already seen it (localStorage flag
 * `wcr-tour-done-v1`). Otherwise pops a centered modal that walks through
 * the four things a new agent must know:
 *   1. Welcome
 *   2. Daily flow (Action List + cold call session)
 *   3. Quick search (Cmd+K / ?)
 *   4. Vault is private
 *
 * Skip / "Let's go" both flip the localStorage flag so the tour never
 * shows again on this device. The settings page exposes a "Restart
 * onboarding tour" button that clears the key.
 */
const STORAGE_KEY = "wcr-tour-done-v1";
const TOTAL_STEPS = 4;

type Step = {
  title: string;
  body: React.ReactNode;
  visual: React.ReactNode;
  tip?: string;
  cta: string;
};

const STEPS: Step[] = [
  {
    title: "Welcome",
    body: (
      <>
        Welcome to <b>White Collar Realty CRM</b>. This 30-second tour
        will show you 4 things to know before you start.
      </>
    ),
    visual: <div className="text-6xl">👋</div>,
    cta: "Next",
  },
  {
    title: "Your daily flow",
    body: (
      <>
        Open the <b>Action List</b> every morning. It shows the leads
        that need a call right now. Press <kbd className="kbd">1</kbd>–
        <kbd className="kbd">6</kbd> in a cold call session for one-tap
        outcomes.
      </>
    ),
    visual: <div className="text-5xl">📋</div>,
    tip: "🎯 Action List + cold call session = your day.",
    cta: "Next",
  },
  {
    title: "Quick search",
    body: (
      <>
        Press <kbd className="kbd">Cmd</kbd>+<kbd className="kbd">K</kbd>{" "}
        (or <kbd className="kbd">Ctrl</kbd>+<kbd className="kbd">K</kbd>)
        anywhere to jump to a lead, project, or teammate. Press{" "}
        <kbd className="kbd">?</kbd> for keyboard shortcuts.
      </>
    ),
    visual: <div className="text-5xl">🔎</div>,
    tip: "⌨ Cmd+K · ?",
    cta: "Next",
  },
  {
    title: "Vault is private",
    body: (
      <>
        The <b>Vault</b> is your private space — admins{" "}
        <b className="text-rose-700">NEVER</b> see what you write. Use it
        to vent, log wins, or hit <b>Reset Mode</b> when you&apos;re
        burnt out.
      </>
    ),
    visual: <div className="text-5xl">💛</div>,
    cta: "🚀 Let's go",
  },
];

export default function OnboardingTour() {
  // `null` = still checking localStorage; `false` = don't show; `true` = show.
  // Splitting the check across an effect avoids an SSR/CSR hydration mismatch.
  const [visible, setVisible] = useState<boolean | null>(null);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(false); // controls fade-in opacity

  useEffect(() => {
    try {
      const done = window.localStorage.getItem(STORAGE_KEY);
      if (done === "1") {
        setVisible(false);
      } else {
        setVisible(true);
        // next frame -> trigger CSS transition
        requestAnimationFrame(() => setShown(true));
      }
    } catch {
      // localStorage blocked (private browsing, etc.) — silently skip the
      // tour rather than crashing or showing it on every page load.
      setVisible(false);
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — tour just won't be remembered this session
    }
    setShown(false);
    // tiny delay so the fade-out has time to play before unmount
    setTimeout(() => setVisible(false), 180);
  }

  function next() {
    if (step >= TOTAL_STEPS - 1) {
      dismiss();
    } else {
      setStep((s) => s + 1);
    }
  }

  if (!visible) return null;

  const current = STEPS[step];
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wcr-tour-title"
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 transition-opacity duration-200 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      style={{ background: "rgba(11, 26, 51, 0.55)" }}
    >
      <div
        className={`relative w-full max-w-md bg-white rounded-2xl shadow-2xl border-2 border-[#c9a24b] overflow-hidden transform transition-all duration-200 ${
          shown ? "translate-y-0 scale-100" : "translate-y-2 scale-[0.98]"
        }`}
      >
        {/* Gold accent strip */}
        <div className="h-1.5 bg-gradient-to-r from-[#c9a24b] via-[#e6c878] to-[#c9a24b]" />

        <div className="px-6 pt-6 pb-4 text-center">
          <div className="mb-3 flex items-center justify-center h-20">
            {current.visual}
          </div>
          <h2
            id="wcr-tour-title"
            className="text-xl font-bold text-[#0b1a33]"
          >
            {current.title}
          </h2>
          <p className="mt-2 text-sm text-gray-700 leading-relaxed">
            {current.body}
          </p>
          {current.tip && (
            <div className="mt-4 inline-block bg-[#fff8e6] border border-[#e6c878] text-[#7a5a14] text-xs font-medium px-3 py-1.5 rounded-full">
              {current.tip}
            </div>
          )}
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step
                  ? "w-6 bg-[#c9a24b]"
                  : i < step
                  ? "w-1.5 bg-[#c9a24b]/60"
                  : "w-1.5 bg-gray-300"
              }`}
            />
          ))}
        </div>
        <div className="text-center text-[11px] text-gray-500 pb-2">
          Step {step + 1} of {TOTAL_STEPS}
        </div>

        <div className="px-6 pb-5 pt-2 flex items-center justify-between gap-3 border-t border-gray-100">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2"
          >
            {isLast ? "Got it" : "Skip tour"}
          </button>
          <button
            type="button"
            onClick={next}
            className="px-5 py-2 rounded-lg bg-[#c9a24b] hover:bg-[#b8902f] text-[#0b1a33] font-semibold text-sm shadow"
          >
            {current.cta}
          </button>
        </div>
      </div>

      {/* Minimal inline style for <kbd> chips used in step copy. Scoped via
          class name so it doesn't conflict with any global kbd styling. */}
      <style jsx>{`
        :global(.kbd) {
          display: inline-block;
          padding: 1px 6px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          font-weight: 600;
          color: #0b1a33;
          background: #f5f6fa;
          border: 1px solid #d1d5db;
          border-bottom-width: 2px;
          border-radius: 4px;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
}

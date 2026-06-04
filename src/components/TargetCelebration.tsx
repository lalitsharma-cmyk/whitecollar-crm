"use client";
// Party-popper animation that fires once per target per day.
// Mounts as a client component in the dashboard server page. Uses
// localStorage to remember which targets were already celebrated today so
// the animation doesn't re-trigger on every page refresh.
import { useEffect, useRef } from "react";

interface Props {
  /** Which KPI keys are currently at or above target (e.g. ["calls","deals"]) */
  achievedTargets: string[];
  /** YYYY-MM-DD of "today" in IST — used as the localStorage key namespace */
  date: string;
}

const POPPERS = [
  { left: "4%",  delay: "0s",    emoji: "🎉" },
  { left: "15%", delay: "0.12s", emoji: "🎊" },
  { left: "28%", delay: "0.22s", emoji: "🎉" },
  { left: "40%", delay: "0.08s", emoji: "⭐" },
  { left: "52%", delay: "0.18s", emoji: "🎊" },
  { left: "64%", delay: "0.28s", emoji: "🎉" },
  { left: "76%", delay: "0.14s", emoji: "⭐" },
  { left: "88%", delay: "0.24s", emoji: "🎊" },
];

export default function TargetCelebration({ achievedTargets, date }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (achievedTargets.length === 0) return;

    const storageKey = `wc-celebrated-${date}`;
    let celebrated: string[] = [];
    try {
      celebrated = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    } catch {
      celebrated = [];
    }

    const newlyAchieved = achievedTargets.filter((t) => !celebrated.includes(t));
    if (newlyAchieved.length === 0) return;

    // Persist so refreshes don't re-trigger
    try {
      localStorage.setItem(storageKey, JSON.stringify([...celebrated, ...newlyAchieved]));
    } catch {}

    // Show the animation
    if (containerRef.current) {
      containerRef.current.style.display = "block";
    }
    timerRef.current = setTimeout(() => {
      if (containerRef.current) containerRef.current.style.display = "none";
    }, 4500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [achievedTargets, date]);

  return (
    <>
      <style>{`
        @keyframes wcPop {
          0%   { transform: translateY(0)      scale(0.6) rotate(-10deg); opacity: 1; }
          30%  { transform: translateY(-35vh)  scale(1.4) rotate(8deg);  opacity: 1; }
          70%  { transform: translateY(-70vh)  scale(1.1) rotate(-5deg); opacity: 0.7; }
          100% { transform: translateY(-105vh) scale(0.7) rotate(15deg); opacity: 0; }
        }
      `}</style>
      <div
        ref={containerRef}
        style={{ display: "none" }}
        className="fixed inset-0 pointer-events-none z-[9998] overflow-hidden"
        aria-hidden="true"
      >
        {POPPERS.map((p, i) => (
          <span
            key={i}
            className="absolute bottom-8 text-4xl sm:text-5xl select-none"
            style={{
              left: p.left,
              animation: `wcPop 3.2s cubic-bezier(.17,.67,.39,.97) ${p.delay} forwards`,
            }}
          >
            {p.emoji}
          </span>
        ))}
      </div>
    </>
  );
}

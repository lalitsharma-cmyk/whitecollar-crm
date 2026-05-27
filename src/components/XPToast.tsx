"use client";
// XPToast — bottom-right slide-up notification when XP is awarded.
// Two flavours:
//   • Standard award:   "+20 XP · Connected call"   (compact, 2.5s)
//   • Level-up:         "🎉 Level up: Lead Hunter"  (slightly bigger, 3.5s)
//
// Premium luxury aesthetic — gold-tinted card, subtle slide+fade, NO confetti
// and no sound (the project's NotifBell owns audio cues, we don't double up).
//
// USAGE — imperative API, mount once near the root then call from anywhere:
//
//   import { showXpToast } from "@/components/XPToast";
//   showXpToast({ amount: 20, label: "Connected call" });
//
// The host <XPToastHost /> component listens for window events and renders.

import { useEffect, useState } from "react";

interface XpToastPayload {
  amount: number;
  label: string;
  leveledUp?: boolean;
  newLevel?: string | null;
}

// We use a CustomEvent rather than a context provider so the imperative
// helper can be called from anywhere — fetch callbacks, action handlers —
// without needing to thread a hook through every component.
const EVENT_NAME = "wcr:xp-toast";

export function showXpToast(payload: XpToastPayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
}

interface ToastItem extends XpToastPayload {
  id: number;
}

let nextId = 1;

export default function XPToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onEvent(e: Event) {
      const ce = e as CustomEvent<XpToastPayload>;
      const p = ce.detail;
      if (!p || typeof p.amount !== "number") return;
      const id = nextId++;
      setItems((prev) => [...prev, { ...p, id }]);
      const ttl = p.leveledUp ? 3500 : 2500;
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, ttl);
    }
    window.addEventListener(EVENT_NAME, onEvent);
    return () => window.removeEventListener(EVENT_NAME, onEvent);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none safe-bottom"
      aria-live="polite"
    >
      {items.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
      {/* Subtle slide-up + fade. No bouncy spring — luxury feel. */}
      <style>{`
        @keyframes wcr-xp-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wcr-xp-toast { animation: wcr-xp-in 220ms ease-out; }
      `}</style>
    </div>
  );
}

function ToastCard({ t }: { t: ToastItem }) {
  if (t.leveledUp && t.newLevel) {
    return (
      <div
        className="wcr-xp-toast pointer-events-auto rounded-xl shadow-2xl border-2 px-4 py-3 min-w-[240px] max-w-[320px]"
        style={{
          background: "linear-gradient(135deg, #0b1a33 0%, #152d57 100%)",
          borderColor: "var(--accent-primary)",
          color: "#fff",
        }}
      >
        <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "var(--accent-primary)" }}>
          🎉 Level up
        </div>
        <div className="font-bold text-base mt-0.5">{t.newLevel}</div>
        <div className="text-[11px] text-white/70 mt-0.5">+{t.amount} XP · {t.label}</div>
      </div>
    );
  }
  return (
    <div
      className="wcr-xp-toast pointer-events-auto rounded-lg shadow-lg border bg-white px-3 py-2 min-w-[200px] max-w-[280px] flex items-center gap-2"
      style={{ borderColor: "var(--accent-primary)" }}
    >
      <div
        className="text-sm font-bold shrink-0"
        style={{ color: "var(--accent-primary)" }}
      >
        +{t.amount} XP
      </div>
      <div className="text-xs text-[#0b1a33] truncate">· {t.label}</div>
    </div>
  );
}

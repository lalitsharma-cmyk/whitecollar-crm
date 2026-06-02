"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "off" | "soft" | "hard";
interface Props { initial: Mode; canEdit: boolean; }

// Human labels for each mode — "soft" is shown as "Warn", "hard" as "Strict".
const LABELS: Record<Mode, string> = { off: "Off", soft: "Warn", hard: "Strict" };
const ORDER: Mode[] = ["off", "soft", "hard"];

/**
 * 3-option segmented control for the BANT qualification stage-gate.
 *   • Off    — no check when advancing a lead to Qualified+.
 *   • Warn   — (soft, default) reminds the agent but still allows the move.
 *   • Strict — (hard) blocks the move until all four BANT signals are captured.
 *
 * Mirrors TestingModeToggle's fetch → router.refresh() pattern. Read-only line
 * when the viewer is not an admin.
 */
export default function BantGateToggle({ initial, canEdit }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initial);
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <div className="text-sm mt-2">
        Qualification gate: <b>{LABELS[mode]}</b> (admin can change)
      </div>
    );
  }

  async function choose(next: Mode) {
    if (busy || next === mode) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/bant-gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (r.ok) { setMode(next); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-2">
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
        {ORDER.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              onClick={() => choose(m)}
              disabled={busy}
              className={`px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                active
                  ? m === "hard"
                    ? "bg-rose-600 text-white"
                    : m === "soft"
                      ? "bg-emerald-600 text-white"
                      : "bg-gray-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              } ${m !== "off" ? "border-l border-gray-300" : ""}`}
            >
              {LABELS[m]}
            </button>
          );
        })}
      </div>
      {busy && <span className="ml-2 text-xs text-gray-500">Saving…</span>}
    </div>
  );
}

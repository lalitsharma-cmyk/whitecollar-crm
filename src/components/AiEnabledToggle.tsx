"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  initialAiEnabled: boolean;
  initialTrialModeEnabled: boolean;
  canEdit: boolean;
}

/**
 * Admin-only toggles for the global AI kill-switch and trial-mode gate.
 *
 * ai.enabled — when OFF, no AI scoring / summaries / automated runs fire.
 * ai.trialMode.enabled — lets a bounded pilot call the provider on a small
 *   sample WHILE global AI is still OFF.
 */
export default function AiEnabledToggle({ initialAiEnabled, initialTrialModeEnabled, canEdit }: Props) {
  const router = useRouter();
  const [aiOn, setAiOn] = useState(initialAiEnabled);
  const [trialOn, setTrialOn] = useState(initialTrialModeEnabled);
  const [busy, setBusy] = useState<"ai" | "trial" | null>(null);

  async function toggle(field: "ai" | "trial") {
    setBusy(field);
    const newAi = field === "ai" ? !aiOn : aiOn;
    const newTrial = field === "trial" ? !trialOn : trialOn;
    try {
      const r = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newAi, trialModeEnabled: newTrial }),
      });
      if (r.ok) {
        if (field === "ai") setAiOn(newAi);
        else setTrialOn(newTrial);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (!canEdit) {
    return (
      <div className="space-y-2 mt-2 text-sm">
        <div>{aiOn ? "✅ AI Features: ON" : "⏸ AI Features: OFF"} <span className="text-[10px] text-gray-500">(admin can change)</span></div>
        <div>{trialOn ? "✅ AI Trial Mode: ON" : "⏸ AI Trial Mode: OFF"} <span className="text-[10px] text-gray-500">(admin can change)</span></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-3">
      {/* AI Features toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => toggle("ai")}
          disabled={busy !== null}
          aria-label="Toggle AI Features"
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${aiOn ? "bg-emerald-500" : "bg-gray-400"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiOn ? "translate-x-6" : "translate-x-1"}`} />
        </button>
        <span className={`text-sm font-semibold ${aiOn ? "text-emerald-700" : "text-gray-600"}`}>
          {busy === "ai" ? "Saving…" : aiOn ? "✅ AI Features ON — scoring, summaries, and runs are active" : "⏸ AI Features OFF — no AI calls will fire"}
        </span>
      </div>

      {/* Trial mode toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => toggle("trial")}
          disabled={busy !== null}
          aria-label="Toggle AI Trial Mode"
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${trialOn ? "bg-blue-500" : "bg-gray-400"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${trialOn ? "translate-x-6" : "translate-x-1"}`} />
        </button>
        <span className={`text-sm font-semibold ${trialOn ? "text-blue-700" : "text-gray-600"}`}>
          {busy === "trial" ? "Saving…" : trialOn ? "🧪 Trial Mode ON — bounded trial can call provider while global AI is OFF" : "⏸ Trial Mode OFF"}
        </span>
      </div>
    </div>
  );
}

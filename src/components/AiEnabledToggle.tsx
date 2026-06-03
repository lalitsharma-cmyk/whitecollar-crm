"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  initialAiEnabled: boolean;
  initialTrialModeEnabled: boolean;
  initialMonthlyCostCapUsd: number;
  canEdit: boolean;
}

/**
 * Admin-only toggles for the global AI kill-switch, trial-mode gate,
 * and monthly cost-cap input.
 *
 * ai.enabled — when OFF, no AI scoring / summaries / automated runs fire.
 * ai.trialMode.enabled — lets a bounded pilot call the provider on a small
 *   sample WHILE global AI is still OFF.
 * ai.monthlyCostCapUsd — hard spend cap per calendar month (0 = disabled).
 */
export default function AiEnabledToggle({ initialAiEnabled, initialTrialModeEnabled, initialMonthlyCostCapUsd, canEdit }: Props) {
  const router = useRouter();
  const [aiOn, setAiOn] = useState(initialAiEnabled);
  const [trialOn, setTrialOn] = useState(initialTrialModeEnabled);
  const [capUsd, setCapUsd] = useState<number>(initialMonthlyCostCapUsd);
  const [capInput, setCapInput] = useState<string>(String(initialMonthlyCostCapUsd));
  const [busy, setBusy] = useState<"ai" | "trial" | "cap" | null>(null);

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

  async function saveCap() {
    const n = Number(capInput);
    if (isNaN(n) || n < 0) return;
    setBusy("cap");
    try {
      const r = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthlyCostCapUsd: n }),
      });
      if (r.ok) {
        setCapUsd(n);
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
        <div>Monthly cap: {capUsd > 0 ? `$${capUsd}` : "Disabled"} <span className="text-[10px] text-gray-500">(admin can change)</span></div>
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

      {/* Monthly cost cap */}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Monthly cost cap (USD) — <span className="font-normal text-gray-500">set to 0 to disable</span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={1}
            value={capInput}
            onChange={e => setCapInput(e.target.value)}
            className="w-24 text-sm border border-gray-300 rounded px-2 py-1"
            disabled={busy !== null}
          />
          <button
            onClick={saveCap}
            disabled={busy !== null || capInput === String(capUsd)}
            className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "cap" ? "Saving…" : "Save"}
          </button>
          {capUsd === 0 && <span className="text-xs text-gray-500">No cap active</span>}
          {capUsd > 0 && <span className="text-xs text-gray-500">Cap: ${capUsd}/month</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          When monthly AI spend reaches this threshold, all AI calls are blocked until next month.
        </p>
      </div>
    </div>
  );
}

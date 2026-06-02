"use client";
// Admin control for the B-20 daily-motivation / voice pilot. A single segmented
// switch — Off / India team / Dubai team / Both teams — that POSTs both the
// enabled flag and the target team to /api/settings/motivation-pilot.
import { useState } from "react";
import { useRouter } from "next/navigation";

type PilotMode = "off" | "India" | "Dubai" | "ALL";

interface Props {
  initialEnabled: boolean;
  initialTeam: string; // "", "India", "Dubai", or "ALL"
  canEdit: boolean;
}

function toMode(enabled: boolean, team: string): PilotMode {
  if (!enabled) return "off";
  const t = (team || "").toLowerCase();
  if (t === "all" || t === "both") return "ALL";
  if (t === "dubai") return "Dubai";
  if (t === "india") return "India";
  return "off";
}

const OPTIONS: { mode: PilotMode; label: string; enabled: boolean; team: string }[] = [
  { mode: "off", label: "Off", enabled: false, team: "" },
  { mode: "India", label: "India team", enabled: true, team: "India" },
  { mode: "Dubai", label: "Dubai team", enabled: true, team: "Dubai" },
  { mode: "ALL", label: "Both teams", enabled: true, team: "ALL" },
];

function describe(mode: PilotMode): string {
  switch (mode) {
    case "off": return "⏸ Hidden for everyone.";
    case "India": return "✅ Showing for the India team only.";
    case "Dubai": return "✅ Showing for the Dubai team only.";
    case "ALL": return "✅ Showing for both teams (everyone).";
  }
}

export default function MotivationPilotToggle({ initialEnabled, initialTeam, canEdit }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<PilotMode>(toMode(initialEnabled, initialTeam));
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <div className="text-sm mt-2">
        {describe(mode)} <span className="text-[10px] text-gray-500">(admin can change)</span>
      </div>
    );
  }

  async function choose(opt: (typeof OPTIONS)[number]) {
    if (busy || opt.mode === mode) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings/motivation-pilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: opt.enabled, team: opt.team }),
      });
      if (r.ok) {
        setMode(opt.mode);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
        {OPTIONS.map((opt) => {
          const active = opt.mode === mode;
          return (
            <button
              key={opt.mode}
              type="button"
              onClick={() => choose(opt)}
              disabled={busy}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
                opt.mode !== "off" ? "border-l border-gray-300" : ""
              } ${active ? "bg-[#0b1a33] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className={`text-sm font-semibold mt-2 ${mode === "off" ? "text-amber-700" : "text-emerald-700"}`}>
        {busy ? "Saving…" : describe(mode)}
      </div>
    </div>
  );
}

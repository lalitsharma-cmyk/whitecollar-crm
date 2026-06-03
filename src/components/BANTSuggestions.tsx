"use client";

import { useState } from "react";
import type { BantSuggestion } from "@/lib/bantAutoFill";

interface BANTSuggestionsProps {
  leadId: string;
  suggestions: {
    budget?: BantSuggestion;
    authority?: BantSuggestion;
    need?: BantSuggestion;
    timeline?: BantSuggestion;
    scannedAt?: string;
  } | null;
  currentBudget: number | null;
  currentAuthority: string | null;
  currentNeed: string | null;
  currentTimeline: string | null;
}

type DimKey = "budget" | "authority" | "need" | "timeline";

interface DimConfig {
  key: DimKey;
  label: string;
  current: string | number | null;
  suggestion?: BantSuggestion;
  patchPayload: (s: BantSuggestion) => Record<string, unknown>;
}

function ConfidenceDot({ confidence }: { confidence: string }) {
  if (confidence === "HIGH") return <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />;
  if (confidence === "MEDIUM") return <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1" />;
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 mr-1" />;
}

export default function BANTSuggestions({
  leadId,
  suggestions,
  currentBudget,
  currentAuthority,
  currentNeed,
  currentTimeline,
}: BANTSuggestionsProps) {
  const [applying, setApplying] = useState<DimKey | null>(null);
  const [scanning, setScanning] = useState(false);

  const dims: DimConfig[] = [
    {
      key: "budget",
      label: "Budget",
      current: currentBudget,
      suggestion: suggestions?.budget,
      patchPayload: (s) => ({ budgetMin: s.rawValue }),
    },
    {
      key: "authority",
      label: "Authority",
      current: currentAuthority,
      suggestion: suggestions?.authority,
      patchPayload: (s) => ({ authorityLevel: s.enumValue }),
    },
    {
      key: "need",
      label: "Need",
      current: currentNeed,
      suggestion: suggestions?.need,
      patchPayload: (s) => ({ needSummary: s.value }),
    },
    {
      key: "timeline",
      label: "Timeline",
      current: currentTimeline,
      suggestion: suggestions?.timeline,
      patchPayload: (s) => ({ whenCanInvest: s.enumValue }),
    },
  ];

  // Only show dims that have a suggestion
  const activeDims = dims.filter((d) => d.suggestion);

  async function handleApply(dim: DimConfig) {
    if (!dim.suggestion) return;
    setApplying(dim.key);
    try {
      const res = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dim.patchPayload(dim.suggestion)),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setApplying(null);
    }
  }

  async function handleScan() {
    setScanning(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/bant-autofill`, { method: "POST" });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setScanning(false);
    }
  }

  function isEmpty(val: string | number | null): boolean {
    if (val === null || val === undefined) return true;
    if (typeof val === "string" && (val.trim() === "" || val === "UNKNOWN")) return true;
    if (typeof val === "number" && val === 0) return true;
    return false;
  }

  const hasSuggestions = activeDims.length > 0;

  return (
    <div className="mt-3 pt-3 border-t border-gray-200/60 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
          Auto-detect from history
        </span>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="text-[10px] px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {scanning ? "Scanning…" : "Scan history"}
        </button>
      </div>

      {hasSuggestions ? (
        <div className="space-y-1">
          {activeDims.map((dim) => {
            const s = dim.suggestion!;
            const isNew = isEmpty(dim.current);
            const isDiff = !isNew && String(dim.current) !== s.value && String(dim.current) !== s.enumValue;

            if (!isNew && !isDiff) return null;

            return (
              <div
                key={dim.key}
                className={`flex items-start justify-between gap-2 px-2 py-1.5 rounded text-xs ${
                  isNew ? "bg-blue-50 border border-blue-100" : "bg-amber-50 border border-amber-100"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="font-medium text-gray-700">
                      {isNew ? "💡 Auto-detected:" : "🔄 New info:"}
                    </span>
                    <span className="font-semibold text-gray-900 truncate">{s.value}</span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-500">
                    <ConfidenceDot confidence={s.confidence} />
                    <span>{s.confidence}</span>
                    <span className="text-gray-300">·</span>
                    <span className="truncate">{s.source}</span>
                  </div>
                </div>
                {isNew ? (
                  <button
                    onClick={() => handleApply(dim)}
                    disabled={applying === dim.key}
                    className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {applying === dim.key ? "…" : "Apply"}
                  </button>
                ) : (
                  <button
                    onClick={() => handleApply(dim)}
                    disabled={applying === dim.key}
                    className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                  >
                    {applying === dim.key ? "…" : "Review"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[10px] text-gray-400 italic">
          {suggestions ? "No new suggestions found." : "Click 'Scan history' to auto-detect BANT signals."}
        </div>
      )}

      {suggestions?.scannedAt && (
        <div className="text-[9px] text-gray-300">
          Last scanned {new Date(suggestions.scannedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

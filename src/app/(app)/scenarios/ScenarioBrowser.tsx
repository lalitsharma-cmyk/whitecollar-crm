"use client";

// ScenarioBrowser — the interactive picker for Scenario Mode (/scenarios).
//
// SANDBOX-ONLY LEARNING AID. Pure client-side UI over static, exported content
// (src/lib/crmScenarios.ts) — no LLM, no fetch. Shows the 6 scenarios as a grid;
// clicking one reveals its numbered step-by-step walkthrough (what to click,
// what to expect, why). "Back to all scenarios" returns to the grid.

import { useState } from "react";
import type { Scenario } from "@/lib/crmScenarios";

export default function ScenarioBrowser({ scenarios }: { scenarios: Scenario[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = scenarios.find((s) => s.id === activeId) ?? null;

  // ── Walkthrough view ──────────────────────────────────────────────────────
  if (active) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setActiveId(null)}
          className="text-sm text-gray-500 dark:text-slate-400 hover:text-[#0b1a33] dark:hover:text-white font-medium inline-flex items-center gap-1 mb-4"
        >
          ← Back to all scenarios
        </button>

        <div className="grad-card rounded-2xl p-5 sm:p-6">
          <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest bg-white/15 text-white px-2.5 py-1 rounded-full">
            {active.area}
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-3 flex items-center gap-2">
            <span aria-hidden>{active.emoji}</span>
            {active.title}
          </h2>
          <p className="text-sm text-white/80 mt-1">
            <span className="font-semibold text-white/90">Goal: </span>
            {active.goal}
          </p>
        </div>

        <ol className="mt-5 space-y-3">
          {active.steps.map((step, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-xl bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700 p-4"
            >
              <span className="flex-none grid place-items-center w-8 h-8 rounded-full bg-[#0b1a33] text-white text-sm font-bold">
                {i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[#0b1a33] dark:text-white">{step.action}</div>
                <div className="text-[13px] text-gray-700 dark:text-slate-300 mt-1 flex items-start gap-1.5">
                  <span className="flex-none" aria-hidden>👉</span>
                  <span>
                    <span className="font-semibold">You&apos;ll see: </span>
                    {step.expect}
                  </span>
                </div>
                {step.why && (
                  <div className="text-[13px] text-[#856404] mt-1.5 flex items-start gap-1.5 rounded-lg bg-[#fdfaf2] border border-[#e9d8a6] px-2.5 py-1.5">
                    <span className="flex-none" aria-hidden>💡</span>
                    <span>
                      <span className="font-semibold">Why: </span>
                      {step.why}
                    </span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="btn btn-ghost"
          >
            ← All scenarios
          </button>
        </div>
      </div>
    );
  }

  // ── Grid view ─────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {scenarios.map((s, i) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setActiveId(s.id)}
          className="text-left card p-5 hover:border-[#c9a24b] hover:shadow-md transition-all group"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="text-3xl leading-none" aria-hidden>{s.emoji}</div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500">
              Scenario {i + 1}
            </span>
          </div>
          <h3 className="text-base font-bold text-[#0b1a33] dark:text-white mt-3 group-hover:text-[#856404]">
            {s.title}
          </h3>
          <p className="text-[13px] text-gray-600 dark:text-slate-400 mt-1 leading-relaxed">{s.goal}</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#fdfaf2] text-[#856404] border border-[#e9d8a6] rounded-full px-2 py-0.5">
              {s.area}
            </span>
            <span className="text-xs font-semibold text-[#c9a24b] inline-flex items-center gap-1">
              {s.steps.length} steps →
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

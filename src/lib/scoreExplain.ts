// "Why this score" — presentation adapter for the rule-based score breakdown.
//
// PURE, framework-free, no DB, no side effects, no AI. This file does NOT
// re-implement any scoring weight or threshold. The single source of truth for
// the arithmetic is `explainScore()` in src/lib/leadRescorer.ts, which mirrors
// `computeScore()` step-by-step and emits a `ScoreFactor[]`. This adapter only
// *transforms* those already-computed factors into the compact, signed,
// human-readable shape the lead-detail "Why this score" card renders — so every
// factor surfaced here is guaranteed to be one the real scorer actually applied
// (no invented factors, no drift).
//
// We import ScoreFactor / ScoreFactorKind as TYPES ONLY (erased at compile
// time) so this module stays free of the `server-only` runtime shim that
// leadRescorer.ts pulls in — keeping it a genuinely pure, universally-importable
// helper.

import type { ScoreFactor, ScoreFactorKind } from "@/lib/leadRescorer";
import { formatBudget } from "@/lib/budgetParse";

export type FactorSign = "+" | "−" | "=";

/** One compact contributing factor, ready to render. */
export interface ExplainFactor {
  /** Signed direction: "+" boost, "−" penalty, "=" neutral seed/no-op cap. */
  sign: FactorSign;
  /** Short human label, e.g. "Connected call <14d" or "High budget (2.5 M)". */
  label: string;
  /** Absolute point impact (0 for the neutral seed / a cap that didn't bite). */
  magnitude: number;
  /** Underlying factor kind, preserved for styling/grouping. */
  kind: ScoreFactorKind;
}

function signOf(delta: number, kind: ScoreFactorKind): FactorSign {
  if (kind === "seed") return "="; // seed is a baseline, not a +/- contribution
  if (delta > 0) return "+";
  if (delta < 0) return "−"; // U+2212 minus, matches the breakdown card
  return "="; // cap that didn't move the score
}

/**
 * Enrich the generic factor labels with concrete lead values where it makes the
 * explanation more trustworthy — e.g. show the actual budget figure on the
 * "Budget over 1M" boost. Currency-aware (AED for Dubai, ₹ for India) so the
 * label reads naturally for the team that owns the lead.
 *
 * Only labels that the real scorer already emitted are touched; nothing new is
 * added. Falls back to the original label when we have no better value.
 */
function enrichLabel(
  f: ScoreFactor,
  ctx: { budgetMin: number | null; budgetCurrency: "AED" | "INR" | string | null },
): string {
  if (f.label === "Budget over 1M" && ctx.budgetMin && ctx.budgetMin > 0) {
    const ccy = ctx.budgetCurrency === "INR" ? "INR" : "AED";
    return `High budget (${formatBudget(ctx.budgetMin, ccy)})`;
  }
  return f.label;
}

/**
 * Pick the most decisive factors to surface and format them for display.
 *
 * Ordering: the seed (baseline classification) is always shown first because it
 * frames everything else; the remaining boosts/penalties/caps are ranked by
 * absolute impact (biggest mover first) so the agent sees what actually drove
 * HOT/WARM/COLD. Caps that didn't bite (delta 0) are dropped — they're noise.
 *
 * @param factors  the authoritative ScoreFactor[] from explainScore()
 * @param ctx      lead values used only to enrich labels (budget figure, ccy)
 * @param limit    max factors to return (task spec: 3–5; default 5)
 */
export function topScoreFactors(
  factors: ScoreFactor[],
  ctx: { budgetMin: number | null; budgetCurrency: "AED" | "INR" | string | null },
  limit = 5,
): ExplainFactor[] {
  const seed = factors.find((f) => f.kind === "seed");
  const rest = factors
    .filter((f) => f.kind !== "seed")
    // Drop caps/floors that did not actually change the score (delta 0).
    .filter((f) => f.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const ordered: ScoreFactor[] = seed ? [seed, ...rest] : rest;

  return ordered.slice(0, limit).map((f) => ({
    sign: signOf(f.delta, f.kind),
    label: enrichLabel(f, ctx),
    magnitude: Math.abs(f.delta),
    kind: f.kind,
  }));
}

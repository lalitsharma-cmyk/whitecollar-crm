import "server-only";
// AI Sales OS — the Brain. ONE entry point every module calls: analyzeEntity. Runs the
// Read-Only-First pipeline: build context → deterministic analyze (L1–L3) → for genuinely
// AMBIGUOUS results, an optional LLM reasoning enrichment (L4) via the reason layer.
// NEVER mutates. Deterministic-first: on the default mock engine the explanation is the
// deterministic one (no LLM); a real provider key only enriches ambiguous cases.
import { buildLeadContext } from "./context";
import { analyzeLeadContext } from "./analyze";
import { reasonAboutAmbiguity } from "./reason";
import type { AiResult, AiEntityKind } from "./types";

/** Deterministic analysis only (no LLM). Buyer/Cold/Customer resolve in M2+. */
async function analyzeDeterministic(kind: AiEntityKind, id: string): Promise<AiResult | null> {
  switch (kind) {
    case "lead": {
      const ctx = await buildLeadContext(id);
      return ctx ? analyzeLeadContext(ctx) : null;
    }
    case "buyer":
    case "cold":
    case "customer":
    default:
      return null;
  }
}

/** Full Brain pipeline: deterministic analysis + reasoning enrichment for ambiguity. */
export async function analyzeEntity(kind: AiEntityKind, id: string): Promise<AiResult | null> {
  const base = await analyzeDeterministic(kind, id);
  if (!base) return null;

  // L4 reasoning — ONLY for genuine ambiguity the deterministic rules couldn't settle,
  // and ONLY when a real engine is configured (resolveEngine → mock returns the
  // deterministic explanation unchanged, so nothing changes until a key is set).
  const ambiguous = base.detections.some((d) => d.confidence !== "high") || base.suggestions.some((s) => s.confidence !== "high");
  if (!ambiguous || base.detections.length === 0) return base;

  const top = base.detections[0];
  const outcome = await reasonAboutAmbiguity(
    {
      question: `For this ${kind}, "${top.title}" is the leading signal but confidence isn't high. In one or two sentences, what is the single best next action for the agent?`,
      facts: { detections: base.detections.length, topSignal: top.title, topConfidence: top.confidence },
    },
    base.explanation, // deterministic answer = the fallback (kept on mock / any failure)
  );
  return outcome.usedLlm ? { ...base, explanation: outcome.text, engine: outcome.engine } : base;
}

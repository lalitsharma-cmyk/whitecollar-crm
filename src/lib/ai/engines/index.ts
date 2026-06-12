/**
 * Engine registry. The whole Phase-2 fleet registers here. Adding an engine is
 * one import + one line — routes and UI iterate this map, so nothing else needs
 * to change when the fleet grows.
 *
 * Roadmap (each follows the qualification.ts pattern: types + buildPrompt + mock + parse):
 *   ✅ qualification        — 9-dimension qualification
 *   ⏳ coaching             — what the agent missed / questions not asked / next-best-questions
 *   ⏳ effort               — 5-level effort allocation (Ignore→Lalit intervention)
 *   ⏳ psychology           — decision style, risk, trust, urgency, price sensitivity, triggers
 *   ⏳ inventory            — requirement → available inventory match + sourcing gaps
 *   ⏳ followup             — score last follow-up (Weak/Average/Strong) + reason
 *   ⏳ escalation           — auto-escalate UHNI / AED 5M+ / existing portfolio / family office
 *   ⏳ revival              — revival with substance (new inventory / price revision), never "just checking in"
 *   ⏳ priority             — cross-lead ranking (effort vs probability)
 *   ⏳ fieldSuggestions     — CRM field updates with Accept/Edit/Reject (never auto-applied)
 */
import type { Engine } from "../types";
import { qualificationEngine } from "./qualification";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ENGINES: Record<string, Engine<any>> = {
  [qualificationEngine.key]: qualificationEngine,
};

export type EngineKey = keyof typeof ENGINES;

export function getEngine(key: string): Engine<unknown> | null {
  return ENGINES[key] ?? null;
}

export function listEngines(): Array<{ key: string; title: string; description: string }> {
  return Object.values(ENGINES).map((e) => ({ key: e.key, title: e.title, description: e.description }));
}

export { qualificationEngine };

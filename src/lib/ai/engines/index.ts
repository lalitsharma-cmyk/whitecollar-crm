/**
 * Engine registry. The whole Phase-2 fleet registers here. Adding an engine is
 * one import + one line — routes and UI iterate this map, so nothing else needs
 * to change when the fleet grows.
 *
 *   ✅ director         — headline verdict (missing/ask/action/channel/escalate-nurture-drop)
 *   ✅ qualification    — 9-dimension qualification
 *   ✅ coaching         — what the agent missed / questions not asked / next-best-questions
 *   ✅ followup         — follow-up quality + ready-to-send next message + cadence
 *   ✅ inventory        — requirement → sellable inventory match + sourcing gaps
 *   ⏳ effort           — 5-level effort allocation (P1)
 *   ⏳ psychology       — decision style / risk / trust / triggers (P1)
 *   ⏳ escalation       — UHNI / AED 5M+ / portfolio auto-escalation (P1)
 *   ⏳ revival          — substance-led revival, never "just checking in" (P1)
 *   ⏳ priority         — cross-lead ranking (P1)
 *   ⏳ fieldSuggestions — CRM field updates Accept/Edit/Reject (P1)
 */
import type { Engine } from "../types";
import { directorEngine } from "./director";
import { qualificationEngine } from "./qualification";
import { coachingEngine } from "./coaching";
import { followupEngine } from "./followup";
import { inventoryEngine } from "./inventory";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ENGINES: Record<string, Engine<any>> = {
  [directorEngine.key]: directorEngine,
  [qualificationEngine.key]: qualificationEngine,
  [coachingEngine.key]: coachingEngine,
  [followupEngine.key]: followupEngine,
  [inventoryEngine.key]: inventoryEngine,
};

/** The P0 engines that render in the AI Sales Director panel, in display order. */
export const P0_ENGINE_KEYS = ["director", "qualification", "coaching", "followup", "inventory"] as const;

export type EngineKey = keyof typeof ENGINES;

export function getEngine(key: string): Engine<unknown> | null {
  return ENGINES[key] ?? null;
}

export function listEngines(): Array<{ key: string; title: string; description: string }> {
  return Object.values(ENGINES).map((e) => ({ key: e.key, title: e.title, description: e.description }));
}

export { directorEngine, qualificationEngine, coachingEngine, followupEngine, inventoryEngine };

/**
 * Engine registry. The whole Phase-2 fleet registers here. Adding an engine is
 * one import + one line — routes and UI iterate this map, so nothing else needs
 * to change when the fleet grows. See SALES_DIRECTOR_PRINCIPLES.md (Section 11).
 *
 *   ✅ director         — headline verdict (missing/ask/action/channel/escalate-nurture-drop)
 *   ✅ qualification    — 9-dimension qualification
 *   ✅ coaching         — what the agent missed / questions not asked / next-best-questions
 *   ✅ followup         — follow-up quality + ready-to-send next message + cadence
 *   ✅ inventory        — requirement → sellable inventory match + sourcing gaps
 *   ✅ escalation       — UHNI / portfolio / family-decision / deal-control → escalate + brief
 *   ✅ revival          — substance-led revival, never "just checking in"
 *   ✅ priority         — work-priority score vs all active leads
 *   ⏳ fieldSuggestions — CRM field updates Accept/Edit/Reject (P1, needs DB)
 */
import type { Engine } from "../types";
import { directorEngine } from "./director";
import { qualificationEngine } from "./qualification";
import { coachingEngine } from "./coaching";
import { followupEngine } from "./followup";
import { inventoryEngine } from "./inventory";
import { escalationEngine } from "./escalation";
import { revivalEngine } from "./revival";
import { priorityEngine } from "./priority";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ENGINES: Record<string, Engine<any>> = {
  [directorEngine.key]: directorEngine,
  [qualificationEngine.key]: qualificationEngine,
  [coachingEngine.key]: coachingEngine,
  [followupEngine.key]: followupEngine,
  [inventoryEngine.key]: inventoryEngine,
  [escalationEngine.key]: escalationEngine,
  [revivalEngine.key]: revivalEngine,
  [priorityEngine.key]: priorityEngine,
};

/** Engines rendered in the AI Sales Director panel, in display order. */
export const PANEL_ENGINE_KEYS = [
  "director", "qualification", "coaching", "followup", "inventory", "escalation", "revival", "priority",
] as const;

export type EngineKey = keyof typeof ENGINES;

export function getEngine(key: string): Engine<unknown> | null {
  return ENGINES[key] ?? null;
}

export function listEngines(): Array<{ key: string; title: string; description: string }> {
  return Object.values(ENGINES).map((e) => ({ key: e.key, title: e.title, description: e.description }));
}

export { directorEngine, qualificationEngine, coachingEngine, followupEngine, inventoryEngine, escalationEngine, revivalEngine, priorityEngine };

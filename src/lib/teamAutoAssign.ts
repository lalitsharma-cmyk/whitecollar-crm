import type { Team } from "./teamRouting";
import { istWeekday } from "./datetime";

// ────────────────────────────────────────────────────────────────────────────
// AUTO-ASSIGNMENT BUSINESS RULE (Lalit, 2026-06-30) — the ONE source of truth
// for which agent a NEW lead is auto-assigned to, by team. Pure + unit-testable.
//
//   • Dubai → Lalit Sharma          (always; replaced Mehak Mukhija)
//   • India → Yasir Khan on TUESDAY (IST); Tanuj Chopra every other day
//   • unknown / null team → null    (lead parks awaiting-team)
//
// This decides WHO. It does NOT decide WHETHER auto-assign runs — that stays
// gated by the `websiteAutoAssignEnabled` toggle + the per-caller `autoAssign`
// flag in leadIngest. EXISTING leads are never touched (new-leads-only). Bulk
// imports + buyer-conversions are intentionally NOT routed through here.
// ────────────────────────────────────────────────────────────────────────────

export const ASSIGN_AGENTS = {
  LALIT: "cmplo0t6v0000vpxslasvbwuq", // Lalit Sharma (ADMIN/HQ) — Dubai target
  YASIR: "cmpidrrw00004vphgvyjw6vpf", // Yasir Khan (India)      — Tuesday-India target
  TANUJ: "cmpidrs1n0005vphgg1tj84pj", // Tanuj Chopra (India)    — India default
  MEHAK: "cmpidrrjp0002vphgqb432xq7", // Mehak Mukhija (Dubai)   — legacy, no longer a target
} as const;

/** IST Tuesday === weekday 2 (0=Sun … 6=Sat, JS getDay convention). */
export const IST_TUESDAY = 2;

/**
 * The agent id a NEW lead for `team` should auto-assign to, or `null` when the
 * team is unknown/unmapped (the lead then parks awaiting-team). `now` is
 * injectable for deterministic testing; production passes the real clock.
 */
export function resolveTeamAutoAssignee(
  team: Team | string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (team === "Dubai") return ASSIGN_AGENTS.LALIT;
  if (team === "India") {
    return istWeekday(now) === IST_TUESDAY ? ASSIGN_AGENTS.YASIR : ASSIGN_AGENTS.TANUJ;
  }
  return null;
}

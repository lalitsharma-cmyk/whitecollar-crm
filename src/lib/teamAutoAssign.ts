import type { Team } from "./teamRouting";
import { istWeekday } from "./datetime";

// ────────────────────────────────────────────────────────────────────────────
// AUTO-ASSIGNMENT BUSINESS RULE (Lalit, 2026-06-30) — the ONE source of truth
// for which agent a NEW lead is auto-assigned to, by team. Pure + unit-testable.
//
//   • Dubai → Lalit Sharma          (always; replaced Mehak Mukhija)
//   • India → Tanuj Chopra          (every day; Yasir Khan's Tuesday-IST slot was
//                                    removed when he left the org, 2026-07-23)
//   • unknown / null team → null    (lead parks awaiting-team)
//
// This decides WHO. It does NOT decide WHETHER auto-assign runs — that stays
// gated by the `websiteAutoAssignEnabled` toggle + the per-caller `autoAssign`
// flag in leadIngest. EXISTING leads are never touched (new-leads-only). Bulk
// imports + buyer-conversions are intentionally NOT routed through here.
// ────────────────────────────────────────────────────────────────────────────

export const ASSIGN_AGENTS = {
  LALIT: "cmplo0t6v0000vpxslasvbwuq", // Lalit Sharma (ADMIN/HQ) — Dubai target
  YASIR: "cmpidrrw00004vphgvyjw6vpf", // Yasir Khan (India)      — LEGACY: left org 2026-07-23, no longer a target
  TANUJ: "cmpidrs1n0005vphgg1tj84pj", // Tanuj Chopra (India)    — India target (all days)
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
    // Yasir Khan left the organization (offboarded 2026-07-23) — the Tuesday-IST
    // India slot was his. Collapsed to Tanuj (the existing India default) so no
    // auto-assigned lead can ever route to a deactivated user. Rebalance Tuesdays
    // to another India agent via Admin → Lead Routing if desired; that engine
    // overrides this static fallback.
    return ASSIGN_AGENTS.TANUJ;
  }
  return null;
}
